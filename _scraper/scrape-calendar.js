const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CALENDAR_URL = 'https://ixchelcalendar.com';
const LOGIN_URL = `${CALENDAR_URL}/login`;
const ADMIN_URL = `${CALENDAR_URL}/admin`;
const ROOMS = ['2603', '2604'];
const MONTHS_TO_SCRAPE = 12;
const OUTPUT_PATH = path.join(__dirname, '..', 'js', 'availability.json');

async function login(page, email, password) {
    console.log('Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin**', { timeout: 15000 });
    console.log('Login successful!');
}

async function getMonthLabel(page) {
    return await page.evaluate(() => {
        const allText = document.body.innerText;
        const match = allText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/);
        return match ? match[0] : null;
    });
}

async function navigateToNextMonth(page) {
    await page.click('button.nextPeriod');
    await page.waitForTimeout(6000); // Wait longer for API to load reservations
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
        const eventDetails = {};
        rooms.forEach(r => { 
            reservedDates[r] = new Set(); 
            eventDetails[r] = {};
        });

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

            // Check if this is a reservation (has confirmation number with >)
            if (text.includes('>')) {
                reservedDates[eventRoom].add(dateStr);
                eventDetails[eventRoom][dateStr] = text.replace(/\s+/g, ' ').trim();
            }
        });

        // Step 3: Build final result - for each date in the month
        allDates.forEach(dateStr => {
            const day = parseInt(dateStr.split('-')[2]);
            rooms.forEach(room => {
                result[room][day] = reservedDates[room].has(dateStr) ? 'reserved' : 'free';
            });
        });

        return { result, eventDetails };
    }, ROOMS);

    return { monthLabel, data: data.result, details: data.eventDetails };
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
        await login(page, email, password);
        await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000); // Much longer initial wait for the heavy calendar app to initialize

        const localDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cancun' }); // YYYY-MM-DD
        const output = { lastUpdated: localDate, rooms: { '2603': {}, '2604': {} } };
        const detailsCache = { '2603': {}, '2604': {} };

        for (let i = 0; i < MONTHS_TO_SCRAPE; i++) {
            const { monthLabel, data, details } = await scrapeCurrentMonth(page);
            const parsed = parseMonthLabel(monthLabel);
            if (parsed) {
                const { year, month } = parsed;
                const daysInMonth = new Date(year, month, 0).getDate();
                for (const room of ROOMS) {
                    for (let day = 1; day <= daysInMonth; day++) {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        output.rooms[room][dateStr] = data[room]?.[day] || 'free';
                        if (details[room]?.[dateStr]) {
                            detailsCache[room][dateStr] = details[room][dateStr];
                        }
                    }
                }
                const free2603 = Object.values(data['2603']).filter(v => v === 'free').length;
                const rsrv2603 = Object.values(data['2603']).filter(v => v === 'reserved').length;
                const free2604 = Object.values(data['2604']).filter(v => v === 'free').length;
                const rsrv2604 = Object.values(data['2604']).filter(v => v === 'reserved').length;
                console.log(`  ✓ ${monthLabel}: 603=${free2603} free/${rsrv2603} reserved, 604=${free2604} free/${rsrv2604} reserved`);
            } else {
                console.warn(`  ⚠ Could not parse month: "${monthLabel}"`);
            }
            if (i < MONTHS_TO_SCRAPE - 1) await navigateToNextMonth(page);
        }

        let oldData = null;
        if (fs.existsSync(OUTPUT_PATH)) {
            try {
                oldData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
            } catch (e) {
                console.warn('Could not parse old availability data.');
            }
        }

        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
        console.log(`\n✓ Written to ${OUTPUT_PATH}`);

        if (oldData && oldData.rooms) {
            let emailBody = "Availability Changes Detected:\n\n";
            let hasChanges = false;
            for (const room of ROOMS) {
                let roomChanges = [];
                // Sort dates to make they appear chronologically
                const dates = Object.keys(output.rooms[room]).sort();
                for (const date of dates) {
                    const status = output.rooms[room][date];
                    const oldStatus = oldData.rooms[room]?.[date];
                    if (oldStatus && oldStatus !== status) {
                        const dateObj = new Date(date + 'T12:00:00');
                        const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        let changeText = `• ${formattedDate}: changed from ${oldStatus.toUpperCase()} to ${status.toUpperCase()}`;
                        
                        if (status === 'reserved' && detailsCache[room][date]) {
                            changeText += `\n    ↳ Details: ${detailsCache[room][date]}`;
                        }
                        
                        roomChanges.push(changeText);
                    }
                }
                if (roomChanges.length > 0) {
                    hasChanges = true;
                    emailBody += `Room ${room}:\n${roomChanges.join("\n")}\n\n`;
                }
            }
            if (hasChanges) {
                fs.writeFileSync(path.join(__dirname, 'email_summary.txt'), emailBody);
                console.log('✓ Generated email_summary.txt');
            }
        }
    } catch (err) {
        console.error('Failed:', err.message);
        await page.screenshot({ path: path.join(__dirname, 'debug.png'), fullPage: true });
        console.error('Debug screenshot saved to _scraper/debug.png');
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
