// ============================
//  Shared Rate & Season Data
// ============================
// Single source of truth for rates, seasons, and room mappings.
// Used by both the browser calculator (js/calculator.js) and
// the Node.js scraper (_scraper/scrape-calendar.js).
//
// Rate data combined from 2026 and 2027 rate PDF charts
// Seasons indexed: [2026 Seasons 0-8], [2027 Seasons 9-15]
// Updated Jul 24, 2026: Feb 2027 broken out as premium season

const RATES = {
    "Standard Room":                 [380, 255, 305, 305, 180, 165, 255, 180, 335, 268, 343, 268, 189, 173, 189, 352],
    "One Bedroom Suite":             [470, 345, 395, 395, 270, 255, 345, 270, 415, 362, 433, 362, 284, 268, 284, 436],
    "One Bedroom Suite Beachfront":  [520, 395, 445, 445, 320, 305, 395, 320, 505, 415, 483, 415, 336, 320, 336, 530],
    "One Bedroom Penthouse":         [570, 445, 495, 495, 370, 355, 445, 370, 555, 467, 533, 467, 389, 373, 389, 583],
    "One Bedroom Premium Penthouse": [610, 485, 535, 535, 410, 395, 485, 410, 605, 509, 573, 509, 431, 415, 431, 635],
    "Two Bedroom Suite":             [670, 545, 595, 595, 470, 455, 545, 470, 665, 572, 633, 572, 494, 478, 494, 698],
    "Deluxe Two Bedroom Suite":      [715, 590, 640, 640, 515, 500, 590, 515, 710, 620, 678, 620, 541, 525, 541, 746],
    "Two Bedroom Suite Beachfront":  [760, 635, 685, 685, 560, 545, 635, 560, 755, 667, 723, 667, 588, 572, 588, 793],
    "Two Bedroom Penthouse":         [840, 715, 765, 765, 640, 625, 715, 640, 805, 751, 803, 751, 672, 656, 672, 845],
    "Two Bedroom Premium Penthouse": [1030, 905, 955, 955, 830, 815, 905, 830, 955, 950, 993, 950, 872, 856, 872, 1003],
    "Three Bedroom Penthouse":       [1135, 1010, 1060, 1060, 935, 920, 1010, 935, 1055, 1061, 1098, 1061, 982, 966, 982, 1108]
};

const SEASON_LABELS = [
    "Jan 3 \u2013 Apr 30 (2026)",
    "May 1 \u2013 May 20 (2026)",
    "May 21 \u2013 Jun 30 (2026)",
    "Jul 1 \u2013 Jul 31 (2026)",
    "Aug 1 \u2013 Aug 31 (2026)",
    "Sep 1 \u2013 Oct 31 (2026)",
    "Nov 1 \u2013 Nov 30 (2026)",
    "Dec 1 \u2013 Dec 20 (2026)",
    "Dec 21 \u2013 Jan 2 (2026/27)",
    "Jan 3 \u2013 Jan 31 (2027)",
    "Feb 1 \u2013 Feb 28 (2027)",
    "Mar 1 \u2013 Apr 30 (2027)",
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
        if (year === 2027 && month === 1 && day <= 2) return 8;  // Holiday 2026/27
        if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) return 15; // Holiday
        if (month === 1 && day >= 3) return 9;                                   // Jan 3-31
        if (month === 2) return 10;                                              // Feb (premium)
        if (month >= 3 && month <= 4) return 11;                                 // Mar-Apr
        if (month >= 5 && month <= 8) return 12;                                 // May-Aug
        if (month >= 9 && month <= 10) return 13;                                // Sep-Oct
        if (month === 11 || (month === 12 && day <= 20)) return 14;              // Nov-Dec 20
        return 9;
    }

    // 2026 seasons
    if ((month === 12 && day >= 21) || (month === 1 && day <= 2)) return 8;  // Holiday
    if ((month === 1 && day >= 3) || (month >= 2 && month <= 4)) return 0;   // High
    if (month === 5 && day <= 20) return 1;                                   // May 1-20 (1st yield)
    if (month === 5 || month === 6) return 2;                                 // May 21-Jun 30 (2nd yield)
    if (month === 7) return 3;                                                // Jul (2nd yield)
    if (month === 8) return 4;                                                // Aug (rack)
    if (month >= 9 && month <= 10) return 5;                                  // Sep-Oct (rack)
    if (month === 11) return 6;                                               // Nov (1st yield)
    if (month === 12 && day <= 20) return 7;                                  // Dec 1-20 (rack)
    return 0;
}

// Node.js: export for require(); Browser: already available as globals via <script>
if (typeof module !== 'undefined') {
    module.exports = { RATES, SEASON_LABELS, MONTH_NAMES, OUR_ROOMS, OUR_ROOM_LABELS, ROOM_NUMBERS, ROOM_TYPE, getSeason };
}
