const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RATES, SEASON_LABELS, MONTH_NAMES, OUR_ROOMS, ROOM_NUMBERS, ROOM_TYPE, getSeason } = require('../js/rates');

const CALENDAR_URL = 'https://ixchelcalendar.com';
const LOGIN_URL = `${CALENDAR_URL}/login`;
const ADMIN_URL = `${CALENDAR_URL}/admin`;
const ROOMS = ['2603', '2604'];
const MONTHS_TO_SCRAPE = 12;
const OUTPUT_PATH = path.join(__dirname, '..', 'js', 'availability.json');
const DETAILS_PATH = path.join(__dirname, '..', 'js', 'availability_details.enc');

function getEncryptionKey() {
    const secret = process.env.DETAILS_ENCRYPTION_KEY;
    if (!secret) return null;
    // Derive a 32-byte key from the secret using SHA-256
    return crypto.createHash('sha256').update(secret).digest();
}

function encryptJSON(data, key) {
    const plaintext = JSON.stringify(data);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Format: base64(iv + authTag + ciphertext)
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptJSON(encoded, key) {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = decipher.update(ciphertext) + decipher.final('utf8');
    return JSON.parse(plaintext);
}

async function login(page, email, password, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Navigating to login page... (attempt ${attempt}/${retries})`);
            await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.fill('#email', email);
            await page.fill('#password', password);
            await page.click('button[type="submit"]');
            await page.waitForURL('**/admin**', { timeout: 30000 });
            console.log('Login successful!');
            return;
        } catch (err) {
            console.error(`  ✗ Login attempt ${attempt} failed: ${err.message}`);
            if (attempt === retries) throw err;
            const delay = attempt * 15000; // 15s, 30s
            console.log(`  Retrying in ${delay / 1000}s...`);
            await page.waitForTimeout(delay);
        }
    }
}

async function getMonthLabel(page) {
    return await page.evaluate(() => {
        const allText = document.body.innerText;
        const match = allText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/);
        return match ? match[0] : null;
    });
}

async function waitForCalendarRender(page, previousMonthLabel = null, timeout = 30000) {
    const start = Date.now();
    // Wait for calendar day cells to be present
    await page.waitForSelector('.cv-day', { timeout });

    if (previousMonthLabel) {
        // Poll until the month label changes from the previous value
        while (Date.now() - start < timeout) {
            const currentLabel = await getMonthLabel(page);
            if (currentLabel && currentLabel !== previousMonthLabel) break;
            await page.waitForTimeout(500);
        }
    }
    // Brief buffer for any remaining JS rendering
    await page.waitForTimeout(1500);
}

async function navigateToNextMonth(page, previousMonthLabel, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await page.click('button.nextPeriod');
            await waitForCalendarRender(page, previousMonthLabel);
            return;
        } catch (err) {
            console.warn(`  ⚠ Month navigation attempt ${attempt}/${retries} failed: ${err.message}`);
            if (attempt === retries) throw err;
            // Wait before retrying
            await page.waitForTimeout(5000 * attempt);
        }
    }
}

async function scrapeCurrentMonth(page) {
    const monthLabel = await getMonthLabel(page);
    console.log(`  Scraping: ${monthLabel || 'unknown'}`);

    const data = await page.evaluate((rooms) => {
        const result = {};
        rooms.forEach(r => { result[r] = {}; });

        // Step 1: Get all dates shown in the calendar from cv-day elements
        // Each cv-day has a class like "d2026-04-01" with the full date
        const dayCells = document.querySelectorAll('.cv-day');
        const allDates = new Set();
        dayCells.forEach(cell => {
            // Skip days outside the current month
            if (cell.classList.contains('outsideOfMonth')) return;
            const dateClass = Array.from(cell.classList).find(c => /^d\d{4}-\d{2}-\d{2}$/.test(c));
            if (dateClass) allDates.add(dateClass.substring(1)); // remove 'd' prefix
        });

        // Step 2: Build a map of which dates have reservations
        // Events are div.cv-event inside div.cv-week containers
        // The week container has a class like ws2026-03-29 (week start date)
        // Each event has an offsetN class (0=Sun..6=Sat) indicating which day
        const reservedDates = {};
        rooms.forEach(r => { reservedDates[r] = {}; });

        const events = document.querySelectorAll('.cv-event');
        events.forEach(event => {
            const text = event.textContent.trim();
            // Find which room this event belongs to
            let eventRoom = null;
            for (const room of rooms) {
                if (text.includes(`Room #${room}`)) {
                    eventRoom = room;
                    break;
                }
            }
            if (!eventRoom) return;

            // Get the offset (day of week) from the event's classes
            const offsetMatch = Array.from(event.classList).find(c => /^offset\d$/.test(c));
            if (!offsetMatch) return;
            const offset = parseInt(offsetMatch.replace('offset', ''));

            // Get the week start date from the parent cv-week container
            const weekEl = event.closest('.cv-week');
            if (!weekEl) return;
            const wsClass = Array.from(weekEl.classList).find(c => /^ws\d{4}-\d{2}-\d{2}$/.test(c));
            if (!wsClass) return;
            const weekStart = new Date(wsClass.substring(2) + 'T12:00:00');

            // Calculate actual date: week start + offset days
            const eventDate = new Date(weekStart);
            eventDate.setDate(eventDate.getDate() + offset);
            const dateStr = eventDate.toISOString().split('T')[0];

            if (text.includes('>')) {
                if (!reservedDates[eventRoom][dateStr]) reservedDates[eventRoom][dateStr] = [];
                reservedDates[eventRoom][dateStr].push(text.replace(/\s+/g, ' '));
            }
        });

        // Step 3: Build final result - for each date in the month
        allDates.forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]);
            rooms.forEach(room => {
                const details = reservedDates[room][dateStr] || [];
                result[room][day] = {
                    status: details.length > 0 ? 'reserved' : 'free',
                    details: details
                };
            });
        });

        return result;
    }, ROOMS);

    return { monthLabel, data };
}

function parseMonthLabel(label) {
    if (!label) return null;
    const months = {
        January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
        July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
    };
    const match = label.match(/(\w+)\s+(\d{4})/);
    if (!match) return null;
    return { month: months[match[1]], year: parseInt(match[2]) };
}

// ============================
//  Rate / Cost Calculation
// ============================

// Alias: scraper code uses NIGHTLY_RATES, shared file exports RATES
const NIGHTLY_RATES = RATES;

/**
 * Extract reservation number from detail text like "Room #2603 > 0111111-001"
 */
function extractReservationNumber(detailText) {
    const match = detailText.match(/>\s*(\S+)/);
    return match ? match[1] : null;
}

/**
 * Build grouped reservation objects from the full detailsMap.
 * Returns an array of { resNumber, room, dates[], startDate, endDate }.
 * When both rooms share the same reservation number on overlapping dates,
 * they are merged into a single entry with room='both'.
 */
function groupReservations(detailsMap) {
    // First pass: collect all (room, date, resNumber) tuples
    const entries = []; // { room, dateStr, resNumber }
    for (const room of ROOMS) {
        const dates = Object.keys(detailsMap[room] || {}).sort();
        for (const dateStr of dates) {
            const details = detailsMap[room][dateStr] || [];
            for (const detail of details) {
                const resNum = extractReservationNumber(detail);
                if (resNum) {
                    entries.push({ room, dateStr, resNumber: resNum });
                }
            }
        }
    }

    // Second pass: group consecutive dates by (room, resNumber)
    const groups = []; // { resNumber, room, dates: Set }

    // Process per room to keep things simple
    for (const room of ROOMS) {
        const roomEntries = entries.filter(e => e.room === room).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        let currentGroup = null;
        let prevDate = null;

        for (const entry of roomEntries) {
            const entryDate = new Date(entry.dateStr + 'T12:00:00');
            const isConsecutive = prevDate && ((entryDate - prevDate) === 86400000); // 1 day in ms

            if (currentGroup && currentGroup.resNumber === entry.resNumber && isConsecutive) {
                currentGroup.dates.add(entry.dateStr);
            } else {
                currentGroup = { resNumber: entry.resNumber, room, dates: new Set([entry.dateStr]) };
                groups.push(currentGroup);
            }
            prevDate = entryDate;
        }
    }

    // Third pass: detect "both rooms" — same resNumber with overlapping dates
    const merged = [];
    const used = new Set();

    for (let i = 0; i < groups.length; i++) {
        if (used.has(i)) continue;
        const g = groups[i];

        // Look for a matching group on the other room
        let mergedWith = null;
        for (let j = i + 1; j < groups.length; j++) {
            if (used.has(j)) continue;
            const h = groups[j];
            if (h.resNumber === g.resNumber && h.room !== g.room) {
                // Check for date overlap
                const overlap = [...g.dates].some(d => h.dates.has(d));
                if (overlap) {
                    mergedWith = j;
                    break;
                }
            }
        }

        if (mergedWith !== null) {
            const h = groups[mergedWith];
            const allDates = new Set([...g.dates, ...h.dates]);
            merged.push({ resNumber: g.resNumber, room: 'both', dates: allDates });
            used.add(i);
            used.add(mergedWith);
        } else {
            merged.push(g);
            used.add(i);
        }
    }

    // Sort each group's dates and compute start/end
    return merged.map(g => {
        const sortedDates = [...g.dates].sort();
        return {
            resNumber: g.resNumber,
            room: g.room,
            dates: sortedDates,
            startDate: sortedDates[0],
            endDate: sortedDates[sortedDates.length - 1],
        };
    }).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * Calculate the cost for a reservation, optionally split by month.
 * Returns { totalCost, monthBreakdown: [{ monthName, nights, cost }] }
 */
function calculateReservationCost(dates, roomType) {
    const rates = NIGHTLY_RATES[roomType];
    if (!rates) return null;

    let totalCost = 0;
    const byMonth = {}; // "YYYY-MM" → { monthName, nights, cost }

    for (const dateStr of dates) {
        const d = new Date(dateStr + 'T12:00:00');
        const season = getSeason(d);
        const nightly = rates[season];
        totalCost += nightly;

        const monthKey = dateStr.substring(0, 7); // "YYYY-MM"
        if (!byMonth[monthKey]) {
            byMonth[monthKey] = { monthName: MONTH_NAMES[d.getMonth()], nights: 0, cost: 0 };
        }
        byMonth[monthKey].nights++;
        byMonth[monthKey].cost += nightly;
    }

    const monthBreakdown = Object.keys(byMonth).sort().map(k => byMonth[k]);
    return { totalCost, monthBreakdown };
}

/**
 * Build the cost summary section for the email.
 * Produces separate "Added" and "Removed" sections.
 * Format example:
 *   Noticed 4-17-26: Room #2603 > 0111111-001 4 nights from 5th $330
 *   Noticed 4-17-26: Room #2604 > 0110859-001 7 nights from 29th, 2 in April $470, 5 in May $345
 *   Noticed 4-17-26: Both Rooms > 0112345-001 5 nights from 10th $670 [Two Bedroom Suite]
 */
function buildReservationCostSummary(output, detailsMap, noticedDateStr, changedDates = null, oldDetailsMap = null) {
    // Format the "noticed" date as M-D-YY
    const nd = new Date(noticedDateStr + 'T12:00:00');
    const noticedFormatted = `${nd.getMonth() + 1}-${nd.getDate()}-${String(nd.getFullYear()).slice(-2)}`;

    // Filter reservations to only those overlapping with changed dates
    function filterByChangedDates(reservations) {
        if (!changedDates) return reservations;
        return reservations.filter(res => {
            if (res.room === 'both') {
                return res.dates.some(d => (changedDates['2603'] && changedDates['2603'].has(d)) || (changedDates['2604'] && changedDates['2604'].has(d)));
            } else {
                return res.dates.some(d => changedDates[res.room] && changedDates[res.room].has(d));
            }
        });
    }

    // Format a list of reservations into summary lines
    function formatReservationLines(reservations) {
        const lines = [];
        for (const res of reservations) {
            const totalNights = res.dates.length;
            const startD = new Date(res.startDate + 'T12:00:00');
            const startDay = startD.getDate();

            // Determine room type for pricing
            let roomType;
            let roomLabel;
            if (res.room === 'both') {
                roomType = 'Two Bedroom Suite';
                roomLabel = 'Both Rooms';
            } else {
                roomType = ROOM_TYPE[res.room];
                roomLabel = `Room #${res.room}`;
            }

            const costInfo = calculateReservationCost(res.dates, roomType);
            if (!costInfo) continue;

            // Format the day ordinal
            const dayStr = `${startDay}${ordinalSuffix(startDay)}`;

            // Month/year context for the reservation start date
            const startMonth = `${MONTH_NAMES[startD.getMonth()]} ${startD.getFullYear()}`;

            let line = `Noticed ${noticedFormatted}: ${startMonth} ${roomLabel} > ${res.resNumber} ${totalNights} night${totalNights !== 1 ? 's' : ''} from ${dayStr}`;

            if (costInfo.monthBreakdown.length === 1) {
                // Single month — show per-night rate
                const perNight = Math.round(costInfo.totalCost / totalNights);
                line += ` $${perNight.toLocaleString()}`;
            } else {
                // Multiple months — per-night rate per month
                const parts = costInfo.monthBreakdown.map(m => {
                    const perNight = Math.round(m.cost / m.nights);
                    return `${m.nights} in ${m.monthName} $${perNight.toLocaleString()}`;
                });
                line += `, ${parts.join(', ')}`;
            }

            if (res.room === 'both') {
                line += ' [Two Bedroom Suite]';
            }

            lines.push(line);
        }
        return lines;
    }

    // --- Build current and old reservation lists (filtered to changed dates) ---
    const currentReservations = filterByChangedDates(groupReservations(detailsMap));

    let addedReservations = currentReservations;
    let removedReservations = [];

    if (oldDetailsMap) {
        const oldReservations = filterByChangedDates(groupReservations(oldDetailsMap));
        const currentResNumbers = new Set(currentReservations.map(r => r.resNumber));
        const oldResNumbers = new Set(oldReservations.map(r => r.resNumber));

        // Added = in current but not in old
        addedReservations = currentReservations.filter(r => !oldResNumbers.has(r.resNumber));
        // Removed = in old but not in current
        removedReservations = oldReservations.filter(r => !currentResNumbers.has(r.resNumber));
    }

    const addedLines = formatReservationLines(addedReservations);
    const removedLines = formatReservationLines(removedReservations);

    if (addedLines.length === 0 && removedLines.length === 0) return null;

    let result = '\n---\n';
    if (addedLines.length > 0) {
        result += `Reservations Added:\n${addedLines.join('\n')}\n`;
    }
    if (removedLines.length > 0) {
        if (addedLines.length > 0) result += '\n';
        result += `Reservations Removed:\n${removedLines.join('\n')}\n`;
    }
    return result;
}

function ordinalSuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

async function main() {
    const email = process.env.IXCHEL_EMAIL;
    const password = process.env.IXCHEL_PASSWORD;
    if (!email || !password) {
        console.error('Set IXCHEL_EMAIL and IXCHEL_PASSWORD env vars.');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext()).newPage();

    try {
        let apiFailedError = null;

        // Log network requests so we can debug slow loading in GitHub Actions
        page.on('response', response => {
            const type = response.request().resourceType();
            if (type === 'fetch' || type === 'xhr') {
                const status = response.status();
                const url = response.url();
                console.log(`  [Network] ${status} ${url}`);
                if (url.includes('/admin/disponibilidad/') && status >= 400) {
                    apiFailedError = `API returned ${status} for ${url}`;
                }
            }
        });

        await login(page, email, password);
        await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await waitForCalendarRender(page);

        const localDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cancun' }); // YYYY-MM-DD
        const output = { lastUpdated: localDate, rooms: { '2603': {}, '2604': {} } };
        const detailsMap = { '2603': {}, '2604': {} };

        let lastMonthLabel = null;
        for (let i = 0; i < MONTHS_TO_SCRAPE; i++) {
            let monthResult = null;
            const monthRetries = 3;
            for (let attempt = 1; attempt <= monthRetries; attempt++) {
                try {
                    const { monthLabel, data } = await scrapeCurrentMonth(page);

                    if (apiFailedError) {
                        throw new Error(`Backend calendar API failed (${apiFailedError}). Aborting run to protect data.`);
                    }

                    monthResult = { monthLabel, data };
                    break;
                } catch (err) {
                    console.warn(`  ⚠ Scrape attempt ${attempt}/${monthRetries} for month ${i + 1} failed: ${err.message}`);
                    if (attempt === monthRetries) throw err;
                    // Wait and retry — the page state should still be on the same month
                    await page.waitForTimeout(5000 * attempt);
                }
            }

            const { monthLabel, data } = monthResult;
            const parsed = parseMonthLabel(monthLabel);
            if (parsed) {
                const { year, month } = parsed;
                const daysInMonth = new Date(year, month, 0).getDate();
                for (const room of ROOMS) {
                    for (let day = 1; day <= daysInMonth; day++) {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const dayData = data[room]?.[day] || { status: 'free', details: [] };
                        output.rooms[room][dateStr] = dayData.status;
                        detailsMap[room][dateStr] = dayData.details;
                    }
                }
                const free2603 = Object.values(data['2603']).filter(v => v && v.status === 'free').length;
                const rsrv2603 = Object.values(data['2603']).filter(v => v && v.status === 'reserved').length;
                const free2604 = Object.values(data['2604']).filter(v => v && v.status === 'free').length;
                const rsrv2604 = Object.values(data['2604']).filter(v => v && v.status === 'reserved').length;
                console.log(`  ✓ ${monthLabel}: 603=${free2603} free/${rsrv2603} reserved, 604=${free2604} free/${rsrv2604} reserved`);
            } else {
                console.warn(`  ⚠ Could not parse month: "${monthLabel}"`);
            }

            lastMonthLabel = monthLabel;
            apiFailedError = null; // Reset for next month navigation
            if (i < MONTHS_TO_SCRAPE - 1) await navigateToNextMonth(page, lastMonthLabel);
        }

        let oldData = null;
        if (fs.existsSync(OUTPUT_PATH)) {
            try {
                oldData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
            } catch (e) {
                console.warn('Could not parse old availability data.');
            }
        }

        const encKey = getEncryptionKey();
        let oldDetails = null;
        if (fs.existsSync(DETAILS_PATH)) {
            try {
                if (encKey) {
                    const encrypted = fs.readFileSync(DETAILS_PATH, 'utf8');
                    oldDetails = decryptJSON(encrypted, encKey);
                } else {
                    oldDetails = JSON.parse(fs.readFileSync(DETAILS_PATH, 'utf8'));
                }
            } catch (e) {
                console.warn('Could not read old details data:', e.message);
            }
        }

        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
        console.log(`\n✓ Written to ${OUTPUT_PATH}`);

        if (encKey) {
            fs.writeFileSync(DETAILS_PATH, encryptJSON(detailsMap, encKey));
            console.log(`✓ Written encrypted details to ${DETAILS_PATH}`);
        } else {
            console.warn('⚠ DETAILS_ENCRYPTION_KEY not set — skipping details file (will not persist for next comparison)');
        }

        if (oldData && oldData.rooms) {
            let emailBody = "Availability Changes Detected:\n\n";
            let hasChanges = false;
            const changedDates = { '2603': new Set(), '2604': new Set() };
            for (const room of ROOMS) {
                let roomChanges = [];
                // Sort dates so they appear chronologically
                const dates = Object.keys(output.rooms[room]).sort();
                for (const date of dates) {
                    const status = output.rooms[room][date];
                    const oldStatus = oldData.rooms[room]?.[date];
                    const newDetails = detailsMap[room]?.[date] || [];
                    const prevDetails = oldDetails?.[room]?.[date] || [];
                    const dateObj = new Date(date + 'T12:00:00');
                    const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

                    let isChanged = false;
                    let emailLine = "";

                    if (oldStatus && oldStatus !== status) {
                        isChanged = true;
                        emailLine = `• ${formattedDate}: changed from ${oldStatus.toUpperCase()} to ${status.toUpperCase()}`;
                        if (status === 'reserved' && newDetails.length > 0) {
                            emailLine += `\n    New: ${newDetails.join(', ')}`;
                        }
                        if (oldStatus === 'reserved' && prevDetails.length > 0) {
                            emailLine += `\n    Was: ${prevDetails.join(', ')}`;
                        }
                    } else if (status === 'reserved' && oldStatus === 'reserved') {
                        // Compare base reservation numbers (strip -NNN suffixes) to avoid
                        // false positives when only the suffix changes (e.g., 0108560-001 → 0108560)
                        const extractBaseResNum = (detail) => {
                            const match = detail.match(/>\s*(\d+)/);
                            return match ? match[1] : detail;
                        };
                        const newBaseNums = newDetails.map(extractBaseResNum).sort().join(',');
                        const oldBaseNums = prevDetails.map(extractBaseResNum).sort().join(',');

                        if (newBaseNums !== oldBaseNums) {
                            isChanged = true;
                            emailLine = `• ${formattedDate}: reservation details changed`;
                            if (prevDetails.length > 0) {
                                emailLine += `\n    Was: ${prevDetails.join(', ')}`;
                            }
                            if (newDetails.length > 0) {
                                emailLine += `\n    Now: ${newDetails.join(', ')}`;
                            }
                        }
                    }

                    if (isChanged) {
                        roomChanges.push(emailLine);
                        changedDates[room].add(date);
                    }
                }
                if (roomChanges.length > 0) {
                    hasChanges = true;
                    emailBody += `Room ${room}:\n${roomChanges.join("\n")}\n\n`;
                }
            }
            if (hasChanges) {
                // Build reservation cost summary ONLY for changed reservations
                const costSummary = buildReservationCostSummary(output, detailsMap, localDate, changedDates, oldDetails);
                if (costSummary) {
                    emailBody += costSummary;
                }
                fs.writeFileSync(path.join(__dirname, 'email_summary.txt'), emailBody);
                console.log('✓ Generated email_summary.txt');
            }
        }
    } catch (err) {
        console.error('Failed:', err.message);
        try {
            await page.screenshot({ path: path.join(__dirname, 'debug.png'), fullPage: true, timeout: 10000 });
            console.error('Debug screenshot saved to _scraper/debug.png');
        } catch (ssErr) {
            console.error('Could not save debug screenshot:', ssErr.message);
        }
        throw err; // Re-throw so the top-level retry wrapper can catch and retry
    } finally {
        await browser.close();
    }
}

// Top-level retry wrapper: if the entire scrape fails, retry from scratch
const MAX_RUN_RETRIES = 2;
(async () => {
    for (let run = 1; run <= MAX_RUN_RETRIES; run++) {
        try {
            await main();
            return; // Success — exit
        } catch (err) {
            if (run < MAX_RUN_RETRIES) {
                console.warn(`\n⚠ Run attempt ${run}/${MAX_RUN_RETRIES} failed: ${err.message}`);
                console.warn(`  Retrying entire scrape in 30s...\n`);
                await new Promise(r => setTimeout(r, 30000));
            } else {
                console.error(`\n✗ All ${MAX_RUN_RETRIES} run attempts failed.`);
                process.exit(1);
            }
        }
    }
})();
