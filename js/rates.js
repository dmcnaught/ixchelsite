// ============================
//  Shared Rate & Season Data
// ============================
// Single source of truth for rates, seasons, and room mappings.
// Used by both the browser calculator (js/calculator.js) and
// the Node.js scraper (_scraper/scrape-calendar.js).
//
// Rate data from 2026 and 2027 rate charts
// Seasons indexed: [2026 Seasons 0-3], [2027 Seasons 4-11]
// Updated Sep 3, 2026: past months removed; 2026 Nov/Dec/Holiday up; 2027 Jan/Feb up, Mar-Apr split

const RATES = {
    "Standard Room":                 [165, 305, 255, 460, 343, 393, 343, 268, 189, 173, 189, 352],
    "One Bedroom Suite":             [255, 395, 345, 550, 433, 483, 433, 362, 284, 268, 284, 436],
    "One Bedroom Suite Beachfront":  [305, 445, 395, 600, 483, 533, 483, 415, 336, 320, 336, 530],
    "One Bedroom Penthouse":         [355, 495, 445, 650, 533, 583, 533, 467, 389, 373, 389, 583],
    "One Bedroom Premium Penthouse": [395, 535, 485, 690, 573, 623, 573, 509, 431, 415, 431, 635],
    "Two Bedroom Suite":             [455, 595, 545, 750, 633, 683, 633, 572, 494, 478, 494, 698],
    "Deluxe Two Bedroom Suite":      [500, 640, 590, 795, 678, 728, 678, 620, 541, 525, 541, 746],
    "Two Bedroom Suite Beachfront":  [545, 685, 635, 840, 723, 773, 723, 667, 588, 572, 588, 793],
    "Two Bedroom Penthouse":         [625, 765, 715, 920, 803, 853, 803, 751, 672, 656, 672, 845],
    "Two Bedroom Premium Penthouse": [815, 955, 905, 1110, 993, 1043, 993, 950, 872, 856, 872, 1003],
    "Three Bedroom Penthouse":       [920, 1060, 1010, 1215, 1098, 1148, 1098, 1061, 982, 966, 982, 1108]
};

const SEASON_LABELS = [
    "Sep 1 \u2013 Oct 31 (2026)",
    "Nov 1 \u2013 Nov 30 (2026)",
    "Dec 1 \u2013 Dec 20 (2026)",
    "Dec 21 \u2013 Jan 2 (2026/27)",
    "Jan 3 \u2013 Jan 31 (2027)",
    "Feb 1 \u2013 Feb 28 (2027)",
    "Mar 1 \u2013 Mar 31 (2027)",
    "Apr 1 \u2013 Apr 30 (2027)",
    "May 1 \u2013 Aug 31 (2027)",
    "Sep 1 \u2013 Oct 31 (2027)",
    "Nov 1 \u2013 Dec 20 (2027)",
    "Dec 21 \u2013 Jan 2 (2027/28)"
];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const OUR_ROOMS = ["Standard Room", "One Bedroom Suite", "Two Bedroom Suite"];

const OUR_ROOM_LABELS = {
    "Standard Room": "Room 603 \u2014 Standard Room",
    "One Bedroom Suite": "Room 604 \u2014 One Bedroom Suite",
    "Two Bedroom Suite": "Rooms 603 & 604 \u2014 Two Bedroom Suite"
};

// Maps our room types to room numbers for availability checking
const ROOM_NUMBERS = {
    "Standard Room": ["2603"],
    "One Bedroom Suite": ["2604"],
    "Two Bedroom Suite": ["2603", "2604"]
};

// Room number → room type when booked individually
const ROOM_TYPE = { '2603': 'Standard Room', '2604': 'One Bedroom Suite' };

function getSeason(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    if (year >= 2027) {
        if (year === 2027 && month === 1 && day <= 2) return 3;  // Holiday 2026/27
        if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) return 11; // Holiday
        if (month === 1 && day >= 3) return 4;                                   // Jan 3-31
        if (month === 2) return 5;                                               // Feb (premium)
        if (month === 3) return 6;                                               // Mar
        if (month === 4) return 7;                                               // Apr
        if (month >= 5 && month <= 8) return 8;                                  // May-Aug
        if (month >= 9 && month <= 10) return 9;                                 // Sep-Oct
        if (month === 11 || (month === 12 && day <= 20)) return 10;              // Nov-Dec 20
        return 4;
    }

    // 2026 seasons (Sep onward)
    if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) return 3;  // Holiday
    if (month >= 9 && month <= 10) return 0;                                 // Sep-Oct
    if (month === 11) return 1;                                              // Nov
    if (month === 12 && day <= 20) return 2;                                 // Dec 1-20
    return 0;
}

// ==========================================
//  Historical Rate Schedules & Booking Eras
// ==========================================
// When guests book months in advance, their locked-in reservation rate
// reflects the rate sheet active when Milton sent the rates for that period.
// Ixchel PMS reservation numbers are sequential, allowing us to estimate
// which rate schedule was active when a reservation was booked.
//
// When Milton notifies of future rate updates:
// 1. Update RATES and getSeason above with the new rates.
// 2. Set maxResNumber on the previous era to the reservation # cutoff.
// 3. Append the new era with maxResNumber: Infinity.

function getNightlyRateEra1(date, roomType) {
    // Era 1: Jan 30 - May 19, 2026 (Initial 2026/2027 rate charts)
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    const rates = {
        "Standard Room":    [380, 255, 180, 165, 180, 335, 268, 189, 173, 189, 352],
        "One Bedroom Suite":[470, 345, 270, 255, 270, 415, 362, 284, 268, 284, 436],
        "Two Bedroom Suite":[670, 545, 470, 455, 470, 665, 572, 494, 478, 494, 698]
    }[roomType];
    if (!rates) return null;

    let s = 0;
    if (year >= 2027) {
        if (year === 2027 && month === 1 && day <= 2) s = 5;
        else if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) s = 10;
        else if (month >= 1 && month <= 4) s = 6;
        else if (month >= 5 && month <= 8) s = 7;
        else if (month >= 9 && month <= 10) s = 8;
        else if (month === 11 || (month === 12 && day <= 20)) s = 9;
        else s = 6;
    } else {
        if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) s = 5;
        else if (month >= 1 && month <= 4) s = 0;
        else if (month >= 5 && month <= 7) s = 1;
        else if (month === 8) s = 2;
        else if (month >= 9 && month <= 10) s = 3;
        else if (month === 11 || (month === 12 && day <= 20)) s = 4;
        else s = 0;
    }
    return rates[s];
}

function getNightlyRateEra2(date, roomType) {
    // Era 2: May 20 - Sep 2, 2026 (Summer yield updates & Feb 2027 premium breakout)
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    const rates = {
        "Standard Room":    [380, 255, 305, 305, 180, 165, 255, 180, 335, 268, 343, 268, 189, 173, 189, 352],
        "One Bedroom Suite":[470, 345, 395, 395, 270, 255, 345, 270, 415, 362, 433, 362, 284, 268, 284, 436],
        "Two Bedroom Suite":[670, 545, 595, 595, 470, 455, 545, 470, 665, 572, 633, 572, 494, 478, 494, 698]
    }[roomType];
    if (!rates) return null;

    let s = 0;
    if (year >= 2027) {
        if (year === 2027 && month === 1 && day <= 2) s = 8;
        else if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) s = 15;
        else if (month === 1 && day >= 3) s = 9;
        else if (month === 2) s = 10;
        else if (month >= 3 && month <= 4) s = 11;
        else if (month >= 5 && month <= 8) s = 12;
        else if (month >= 9 && month <= 10) s = 13;
        else if (month === 11 || (month === 12 && day <= 20)) s = 14;
        else s = 9;
    } else {
        if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) s = 8;
        else if (month >= 1 && month <= 4) s = 0;
        else if (month === 5 && day <= 20) s = 1;
        else if ((month === 5 && day >= 21) || month === 6) s = 2;
        else if (month === 7) s = 3;
        else if (month === 8) s = 4;
        else if (month >= 9 && month <= 10) s = 5;
        else if (month === 11) s = 6;
        else if (month === 12 && day <= 20) s = 7;
        else s = 0;
    }
    return rates[s];
}

function getNightlyRateCurrent(date, roomType) {
    // Era 3: Sep 3, 2026 - Present (Current active rates)
    const rates = RATES[roomType];
    if (!rates) return null;
    const season = getSeason(date);
    return rates[season];
}

const RATE_SCHEDULES = [
    {
        id: '2026_spring',
        name: 'Jan 30 – May 19, 2026 (Initial Rates)',
        maxResNumber: 111730,
        getNightlyRate: getNightlyRateEra1
    },
    {
        id: '2026_summer',
        name: 'May 20 – Sep 2, 2026 (Summer Yield Updates)',
        maxResNumber: 114535,
        getNightlyRate: getNightlyRateEra2
    },
    {
        id: 'current',
        name: 'Sep 3, 2026 – Present (Current)',
        maxResNumber: Infinity,
        getNightlyRate: getNightlyRateCurrent
    }
];

function getRateSchedule(resNumber) {
    if (!resNumber) return RATE_SCHEDULES[RATE_SCHEDULES.length - 1];
    const match = String(resNumber).match(/^(\d+)/);
    const base = match ? match[1] : resNumber;
    const num = parseInt(base, 10);
    if (isNaN(num)) return RATE_SCHEDULES[RATE_SCHEDULES.length - 1];
    for (const schedule of RATE_SCHEDULES) {
        if (num <= schedule.maxResNumber) {
            return schedule;
        }
    }
    return RATE_SCHEDULES[RATE_SCHEDULES.length - 1];
}

function getCurrentRateSchedule() {
    return RATE_SCHEDULES[RATE_SCHEDULES.length - 1];
}

// Node.js: export for require(); Browser: already available as globals via <script>
if (typeof module !== 'undefined') {
    module.exports = {
        RATES,
        SEASON_LABELS,
        MONTH_NAMES,
        OUR_ROOMS,
        OUR_ROOM_LABELS,
        ROOM_NUMBERS,
        ROOM_TYPE,
        getSeason,
        RATE_SCHEDULES,
        getRateSchedule,
        getCurrentRateSchedule
    };
}
