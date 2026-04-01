// Rate data from IXCHEL RATE UPDATE - JAN-30-2026 V1
// Seasons indexed: [Jan 3–Apr 30, May 1–Jul 31, Aug 1–31, Sep 1–Oct 31, Nov 1–Dec 20, Dec 21–Jan 2]
const RATES = {
    "Standard Room":                 [380, 255, 180, 165, 180, 335],
    "One Bedroom Suite":             [470, 345, 270, 255, 270, 415],
    "One Bedroom Suite Beachfront":  [520, 395, 320, 305, 320, 505],
    "One Bedroom Penthouse":         [570, 445, 370, 355, 370, 555],
    "One Bedroom Premium Penthouse": [610, 485, 410, 395, 410, 605],
    "Two Bedroom Suite":             [670, 545, 470, 455, 470, 665],
    "Deluxe Two Bedroom Suite":      [715, 590, 515, 500, 515, 710],
    "Two Bedroom Suite Beachfront":  [760, 635, 560, 545, 560, 755],
    "Two Bedroom Penthouse":         [840, 715, 640, 625, 640, 805],
    "Two Bedroom Premium Penthouse": [1030, 905, 830, 815, 830, 955],
    "Three Bedroom Penthouse":       [1135, 1010, 935, 920, 935, 1055]
};

const SEASON_LABELS = [
    "Jan 3 – Apr 30",
    "May 1 – Jul 31",
    "Aug 1 – Aug 31",
    "Sep 1 – Oct 31",
    "Nov 1 – Dec 20",
    "Dec 21 – Jan 2"
];

const OUR_ROOMS = ["Standard Room", "One Bedroom Suite", "Two Bedroom Suite"];

const OUR_ROOM_LABELS = {
    "Standard Room": "Room 603 — Standard Room",
    "One Bedroom Suite": "Room 604 — One Bedroom Suite",
    "Two Bedroom Suite": "Rooms 603 & 604 — Two Bedroom Suite"
};

function getSeason(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) return 5;
    if ((month === 1 && day >= 3) || (month >= 2 && month <= 4)) return 0;
    if (month >= 5 && month <= 7) return 1;
    if (month === 8) return 2;
    if (month >= 9 && month <= 10) return 3;
    if (month === 11 || (month === 12 && day <= 20)) return 4;

    return 0;
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    html += '<h4>Estimated Cost</h4>';
    html += `<p class="calc-room-label">${roomLabel}</p>`;
    html += `<p class="calc-dates">${formatDate(checkin)} &rarr; ${formatDate(checkout)} &middot; ${totalNights} night${totalNights !== 1 ? 's' : ''}</p>`;

    // Breakdown table
    html += '<table class="calc-breakdown">';
    html += '<thead><tr><th>Season</th><th>Nights</th><th>Rate/Night</th><th>Subtotal</th></tr></thead>';
    html += '<tbody>';

    const sortedSeasons = Object.keys(breakdown).sort((a, b) => Number(a) - Number(b));

    for (const seasonIdx of sortedSeasons) {
        const s = breakdown[seasonIdx];
        html += `<tr>
            <td>${s.label}</td>
            <td>${s.nights}</td>
            <td>$${s.rate.toLocaleString()}</td>
            <td>$${(s.nights * s.rate).toLocaleString()}</td>
        </tr>`;
    }

    html += '</tbody></table>';

    html += `<div class="calc-total">
        <span>Estimated Total</span>
        <span class="calc-total-amount">$${totalCost.toLocaleString()} USD</span>
    </div>`;

    if (isOurRoom) {
        html += '<p class="calc-note calc-note-ours">\u2713 This is one of our privately owned rooms \u2014 booking is subject to availability. If our specific room is unavailable for your dates, we can also submit a general reservation request for this room type with the hotel on your behalf.</p>';
    } else {
        html += '<p class="calc-note calc-note-general">\u2139\uFE0F We can submit a reservation request for this room type on your behalf. Approval is subject to availability.</p>';
    }

    html += '<p class="calc-fine-print">Rates are estimates based on current published rates and are subject to change. Final pricing will be confirmed at booking.</p>';
    html += '</div>';

    showResult(resultDiv, html);
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showResult(el, html) {
    el.style.display = 'none';
    el.innerHTML = html;
    // Force reflow so animation retriggers
    void el.offsetWidth;
    el.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
    const checkin = document.getElementById('calc-checkin');
    const checkout = document.getElementById('calc-checkout');
    const calcBtn = document.getElementById('calc-btn');

    if (!checkin || !checkout || !calcBtn) return;

    // Set minimum date to today
    const today = new Date().toISOString().split('T')[0];
    checkin.min = today;
    checkout.min = today;

    // Auto-adjust checkout min when checkin changes
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
});
