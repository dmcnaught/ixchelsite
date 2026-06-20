// Rate data, season logic, and room mappings are defined in js/rates.js
// (loaded before this script via <script> tag in index.html)

// Availability data (loaded from JSON)
let availabilityData = null;

function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Check availability for a room type across a date range
function checkAvailability(roomType, checkin, checkout) {
    if (!availabilityData || !OUR_ROOMS.includes(roomType)) return null;

    const roomNums = ROOM_NUMBERS[roomType];
    if (!roomNums) return null;

    const unavailableDates = [];
    const currentDate = new Date(checkin);

    while (currentDate < checkout) {
        const dateKey = formatDateKey(currentDate);
        for (const roomNum of roomNums) {
            const status = availabilityData.rooms?.[roomNum]?.[dateKey];
            if (status && status !== 'free') {
                unavailableDates.push({ date: new Date(currentDate), room: roomNum, status });
                break; // one room being unavailable is enough
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
        available: unavailableDates.length === 0,
        unavailableDates,
        hasData: true
    };
}

function calculateStay() {
    const checkinInput = document.getElementById('calc-checkin');
    const checkoutInput = document.getElementById('calc-checkout');
    const roomSelect = document.getElementById('calc-room');
    const resultDiv = document.getElementById('calc-result');

    if (!checkinInput.value || !checkoutInput.value) {
        showResult(resultDiv, '<p class="calc-error">Please select both check-in and check-out dates.</p>');
        return;
    }

    const checkin = new Date(checkinInput.value + 'T12:00:00');
    const checkout = new Date(checkoutInput.value + 'T12:00:00');

    if (checkout <= checkin) {
        showResult(resultDiv, '<p class="calc-error">Check-out date must be after check-in date.</p>');
        return;
    }

    const roomType = roomSelect.value;
    const rates = RATES[roomType];

    // Calculate per-night costs grouped by season
    const breakdown = {};
    let totalCost = 0;
    let totalNights = 0;

    const currentDate = new Date(checkin);
    while (currentDate < checkout) {
        const season = getSeason(currentDate);
        const nightlyRate = rates[season];
        if (!breakdown[season]) {
            breakdown[season] = { nights: 0, rate: nightlyRate, label: SEASON_LABELS[season] };
        }
        breakdown[season].nights++;
        totalCost += nightlyRate;
        totalNights++;
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Build result HTML
    const isOurRoom = OUR_ROOMS.includes(roomType);
    const roomLabel = isOurRoom ? OUR_ROOM_LABELS[roomType] : roomType;

    let html = '<div class="calc-result-inner">';

    // Availability check (only for our rooms)
    if (isOurRoom) {
        const avail = checkAvailability(roomType, checkin, checkout);
        if (avail && avail.hasData) {
            if (avail.available) {
                html += '<div class="calc-avail calc-avail-yes"><span class="calc-avail-icon">\u2705</span> These dates appear to be available!</div>';
            } else {
                html += '<div class="calc-avail calc-avail-no"><span class="calc-avail-icon">\u274C</span><span>Some of your selected dates are currently reserved — but don\'t give up! General hotel reservations can often be moved to free up this specific room.<br><a href="#contact" class="calc-avail-link">Contact us</a> and we\'ll see what we can do.</span></div>';
            }
        }
    }

    html += '<h4>Estimated Cost</h4>';
    html += `<p class="calc-room-label">${roomLabel}</p>`;
    html += `<p class="calc-dates">${formatDate(checkin)} &rarr; ${formatDate(checkout)} &middot; ${totalNights} night${totalNights !== 1 ? 's' : ''}</p>`;

    // Breakdown table
    html += '<table class="calc-breakdown"><thead><tr><th>Season</th><th>Nights</th><th>Rate/Night</th><th>Subtotal</th></tr></thead><tbody>';
    const sortedSeasons = Object.keys(breakdown).sort((a, b) => Number(a) - Number(b));
    for (const seasonIdx of sortedSeasons) {
        const s = breakdown[seasonIdx];
        html += `<tr><td>${s.label}</td><td>${s.nights}</td><td>$${s.rate.toLocaleString()}</td><td>$${(s.nights * s.rate).toLocaleString()}</td></tr>`;
    }
    html += '</tbody></table>';

    const subtotal = totalCost / 1.19;
    const taxAmount = totalCost - subtotal;

    html += '<div class="calc-breakout" style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; margin-top: 12px; font-size: 0.9em; opacity: 0.9;">';
    html += `   <div>Room Subtotal: <strong>$${subtotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></div>`;
    html += `   <div>Taxes (19%): <strong>$${taxAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></div>`;
    html += '</div>';

    html += `<div class="calc-total"><span>Estimated Total</span><span class="calc-total-amount">$${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD</span></div>`;

    if (isOurRoom) {
        html += '<p class="calc-note calc-note-ours">\u2713 This is one of our privately owned rooms \u2014 booking is subject to availability. If our specific room is unavailable for your dates, we can also submit a general reservation request for this room type with the hotel on your behalf.</p>';
    } else {
        html += '<p class="calc-note calc-note-general">\u2139\uFE0F We can submit a reservation request for this room type on your behalf. Approval is subject to availability.</p>';
    }

    html += '<p class="calc-fine-print">All rates include taxes. Estimates are based on current published rates and are subject to change. Final pricing will be confirmed at booking.</p>';

    // CTA buttons — this is the key conversion moment
    html += '<div class="calc-cta-buttons" style="margin-top: 1.5rem; display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">';
    html += `<a href="#contact" class="btn-primary btn-large calc-book-btn" data-dates="${checkinInput.value} to ${checkoutInput.value}" data-room="${roomLabel}" style="text-decoration: none; text-align: center; flex: 1; min-width: 200px;">Book These Dates</a>`;
    html += '<a href="messenger-redirect.html" target="_blank" rel="noopener noreferrer" class="btn-secondary calc-msg-btn" style="text-decoration: none; text-align: center; flex: 1; min-width: 200px;">Message Us on Facebook</a>';
    html += '</div>';
    html += '<p style="text-align: center; margin-top: 0.75rem; font-size: 0.85rem; color: var(--text-light);">We respond to all inquiries personally, usually within a few hours.</p>';

    html += '</div>';

    showResult(resultDiv, html);
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Wire up "Book These Dates" CTA to pre-fill the contact form
    const bookBtn = resultDiv.querySelector('.calc-book-btn');
    if (bookBtn) {
        bookBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const datesField = document.querySelector('input[name="dates"]');
            const messageField = document.querySelector('textarea[name="message"]');
            if (datesField) {
                datesField.value = this.dataset.dates;
            }
            if (messageField && !messageField.value) {
                messageField.value = `Hi! I'd like to book ${this.dataset.room} for ${this.dataset.dates}. The estimated total was $${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD.`;
            }
            document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
            // Focus the name field so they can start filling in details
            setTimeout(() => {
                const nameField = document.querySelector('input[name="name"]');
                if (nameField) nameField.focus();
            }, 800);
        });
    }

    // Track estimate generation in Google Analytics
    if (typeof gtag === 'function') {
        gtag('event', 'generate_estimate', {
            'room_type': roomType,
            'total_nights': totalNights,
            'predicted_value': totalCost,
            'currency': 'USD',
            'checkin_date': checkinInput.value,
            'checkout_date': checkoutInput.value
        });
    }

    // Track estimate generation in Facebook Ads as a Custom Event
    if (typeof fbq === 'function') {
        fbq('trackCustom', 'GenerateEstimate', {
            room_type: roomType,
            total_nights: totalNights,
            value: totalCost,
            currency: 'USD',
            checkin_date: checkinInput.value,
            checkout_date: checkoutInput.value
        });
        // Also fire standard InitiateCheckout — FB optimizes better on
        // standard events than custom ones, helping the campaign exit
        // learning phase faster with more conversion signal.
        fbq('track', 'InitiateCheckout', {
            content_name: roomLabel,
            content_category: roomType,
            num_items: totalNights,
            value: totalCost,
            currency: 'USD'
        });
    }
}

function showResult(el, html) {
    el.style.display = 'none';
    el.innerHTML = html;
    void el.offsetWidth;
    el.style.display = 'block';
}

// ============================
//  Visual Availability Calendar
// ============================

function renderAvailabilityCalendars() {
    const container = document.getElementById('availability-calendars');
    if (!container || !availabilityData) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Render 10 months of calendars
    let html = '';
    for (let i = 0; i < 12; i++) {
        const targetDate = new Date(currentYear, currentMonth + i, 1);
        html += renderMonth(targetDate.getFullYear(), targetDate.getMonth());
    }

    container.innerHTML = html;
}

function renderMonth(year, month) {
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

    let html = '<div class="avail-month">';
    html += `<h4 class="avail-month-title">${monthNames[month]} ${year}</h4>`;
    html += '<div class="avail-grid">';

    // Day headers
    dayNames.forEach(d => { html += `<div class="avail-day-header">${d}</div>`; });

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="avail-day avail-empty"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cellDate = new Date(year, month, day);
        const isPast = cellDate < today;

        const status2603 = availabilityData.rooms?.['2603']?.[dateKey] || 'unknown';
        const status2604 = availabilityData.rooms?.['2604']?.[dateKey] || 'unknown';

        // Determine overall status for display
        let cellClass = 'avail-day';
        if (isPast) {
            cellClass += ' avail-past';
        } else if (status2603 === 'free' && status2604 === 'free') {
            cellClass += ' avail-both-free';
        } else if (status2603 === 'free' || status2604 === 'free') {
            cellClass += ' avail-one-free';
        } else if (status2603 === 'unknown' && status2604 === 'unknown') {
            cellClass += ' avail-unknown';
        } else {
            cellClass += ' avail-booked';
        }

        // Tooltip
        let title = `${monthNames[month]} ${day}: `;
        if (isPast) {
            title += 'Past date';
        } else {
            title += `603: ${status2603}, 604: ${status2604}`;
        }

        html += `<div class="${cellClass}" title="${title}"><span class="avail-day-num">${day}</span>`;
        if (!isPast && (status2603 !== 'unknown' || status2604 !== 'unknown')) {
            html += '<div class="avail-room-dots">';
            html += `<span class="avail-dot ${status2603 === 'free' ? 'dot-603-free' : 'dot-603-booked'}" title="Room 603: ${status2603}"></span>`;
            html += `<span class="avail-dot ${status2604 === 'free' ? 'dot-604-free' : 'dot-604-booked'}" title="Room 604: ${status2604}"></span>`;
            html += '</div>';
        }
        html += '</div>';
    }

    html += '</div></div>';
    return html;
}

// ============================
//  Initialization
// ============================

async function loadAvailability() {
    try {
        const resp = await fetch('js/availability.json');
        if (resp.ok) {
            availabilityData = await resp.json();

            // Update the "last updated" display
            const lastUpdatedEl = document.getElementById('avail-last-updated');
            if (lastUpdatedEl && availabilityData.lastUpdated) {
                const d = new Date(availabilityData.lastUpdated + 'T12:00:00');
                lastUpdatedEl.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            }

            renderAvailabilityCalendars();
        }
    } catch (e) {
        console.warn('Could not load availability data:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const checkin = document.getElementById('calc-checkin');
    const checkout = document.getElementById('calc-checkout');
    const calcBtn = document.getElementById('calc-btn');

    if (!checkin || !checkout || !calcBtn) return;

    const today = new Date().toISOString().split('T')[0];
    checkin.min = today;
    checkout.min = today;

    checkin.addEventListener('change', () => {
        if (checkin.value) {
            const nextDay = new Date(checkin.value + 'T12:00:00');
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = nextDay.toISOString().split('T')[0];
            checkout.min = nextDayStr;
            if (checkout.value && checkout.value <= checkin.value) {
                checkout.value = nextDayStr;
            }
        }
    });

    calcBtn.addEventListener('click', calculateStay);

    // Load availability data
    loadAvailability();
});
