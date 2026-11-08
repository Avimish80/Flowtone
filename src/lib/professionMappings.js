/**
 * Flowtone Profession & Role Mappings Configuration
 *
 * This file serves as the single source of truth for personalizing
 * the application's terminology, examples, notification templates,
 * demo data, library sections, and placeholders depending on the user's role.
 *
 * ─── DETECTED HARDCODED LOCATIONS IN APPSHELL ───
 *
 * 1. src/lib/notificationPrefs.js
 *    - Line 15:  example: '"Gig tomorrow: Blue Moon Jazz at 18:30"'
 *    - Line 32:  example: '"Call time in 1 hour: Blue Moon Jazz Club"'
 *    - Line 43:  example: '"Leave in 20 min for Blue Moon Jazz Club"'
 *    - Line 54:  example: '"Starting in 30 min: Jazz Night"'
 *    - Line 72:  example: '"You played Jazz Night yesterday. Send invoice?"' (played)
 *    - Line 90:  example: '"I need the fee for Jazz Night so I can make the invoice"'
 *    - Line 115: example: '"I can\'t plan travel to Wedding Reception — no location yet"'
 *    - Line 121: example: '"I added \'Wedding\' from your calendar but it has no location"'
 *    - Line 133: example: '"Wedding: no venue, no invoice, no deposit"'
 *    - Line 146: example: '"Practice session in 30 min: sweeping technique"' (guitar-specific)
 *    - Line 156: example: '"Your technique goal is due in 3 days"'
 *
 * 2. src/lib/pushManager.js
 *    - Line 410: body: `You played yesterday — create and send the invoice` (played)
 *
 * 3. src/pages/AppSettings.jsx
 *    - Line 496: placeholder="e.g. Guitarist"
 *    - Line 507: placeholder="A few lines the assistant should always know — e.g. 'I'm a session guitarist based in London...'"
 *
 * 4. src/pages/ChartDetail.jsx
 *    - Line 12:  desc: "Lead sheet, chord chart, sheet music"
 *    - Line 17:  MUSIC_KEYS list (C, G, D, etc.)
 *    - Line 238 & 247: placeholder="Jazz, Pop, Classical…" / "Jazz, Pop, Soul…"
 *    - Line 267: placeholder="Add tag (e.g. standard, original, wedding)…" (standard = jazz standard)
 *
 * 5. src/pages/DocumentDetail.jsx
 *    - Line 1798: placeholder="e.g. Jazz Night at Blue Note"
 *
 * 6. src/pages/Packages.jsx
 *    - Line 203: "Create packages like 'DJ solo' or 'DJ + sax'..."
 *    - Line 283: placeholder="Package name (e.g. DJ + Saxophone)"
 *
 * 7. src/pages/Practice.jsx
 *    - Line 9:   Lucide Guitar icon imported and used as decorative/optional link label
 *    - Line 271: <Guitar className="w-3 h-3" /> icon inside practice form label
 *    - Line 326: placeholder="What did you practice? (e.g. Major scales, Giant Steps…)" (Giant Steps = Coltrane jazz standard)
 *    - Line 379: placeholder="e.g. Learn Autumn Leaves in all 12 keys" (Autumn Leaves = jazz standard)
 *
 * 8. src/pages/Equipment.jsx
 *    - Line 8:   const CATEGORIES = ["instrument", "amp", "pedal", "accessory", "other"]
 *
 * 9. src/lib/busyMusicianTestData.js (Demo Data Button "✨ Load Connected Demo Data")
 *    - Client names: The Blue Note, Ronnie Scott's, Pizza Express Jazz, 606 Club, Vortex Jazz Club (jazz clubs)
 *    - Gig titles: Jazz Night @ Blue Note, Jazz Quartet, Late Night Jazz, etc.
 *    - Lesson titles: `title: ${s.name} – Guitar Lesson` (Guitar Lesson)
 *    - Invoice description: "4x Guitar Lessons"
 *    - Practice Goals: Master ii-V-I improvisation, sight-reading jazz standards, fingerpicking techniques
 *    - Equipment: Fender Stratocaster, Gibson Les Paul, Yamaha Classical, Marshall Amp, Boss TU-3 Tuner Pedal, Guitar Case
 *
 * 10. src/components/onboarding/onboardingScript.js
 *    - Line 2:  export const PROFESSION_OPTIONS = ["Guitarist", "Pianist", "Singer", "Drummer", "Teacher", "Producer"];
 *
 * 11. src/components/tour/CoachMarks.jsx
 *    - Line 18: body: "Tap me anytime — say \"book a wedding Friday for £400\" and it's done."
 *
 * 12. src/lib/invoiceTemplates.js
 *    - Line 33: footer_text fallback: "Thank you for the music."
 *    - Line 748: TEMPLATE 5 - "Studio" - "Purple gradient with a music motif — made for musicians"
 *
 */

export const PROFESSION_FAMILIES = {
  MUSICIAN: "musician",          // Guitarist, Pianist, Violinist, Saxophonist, Drummer, etc.
  VOCALIST: "vocalist",          // Singer, Vocal Coach
  DJ: "dj",                      // DJ, Electronic Music Producer
  VISUAL_CREATOR: "visual",      // Photographer, Videographer
  TEACHER: "teacher",            // Instrumental teacher, General music instructor
};

export const PROFESSION_MAPPINGS = {
  // ─── GUITARIST ─────────────────────────────────────────────────────────────
  guitarist: {
    id: "guitarist",
    label: "Guitarist",
    family: PROFESSION_FAMILIES.MUSICIAN,
    verbPlayed: "played",
    workNameSingular: "gig",
    workNamePlural: "gigs",
    practiceTerm: "practice",
    libraryLabel: "Library",
    libraryDesc: "Chord charts, sheet music, tabs",
    gearCategories: ["instrument", "amp", "pedal", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Jazz Night at Blue Note",
      aboutMe: "I'm a session guitarist based in London. I mostly do jazz and corporate events. My lesson rate is £50/hour.",
      practiceItem: "e.g. Major scales, Giant Steps…",
      practiceGoal: "e.g. Learn Autumn Leaves in all 12 keys",
      packageName: "e.g. Acoustic Guitar Solo",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "Gig tomorrow: Blue Moon Jazz at 18:30",
      gig_load_in: "Call time in 1 hour: Blue Moon Jazz Club",
      gig_leave_now: "Leave in 20 min for Blue Moon Jazz Club",
      gig_starting_soon: "Starting in 30 min: Jazz Night",
      invoice_not_sent: "You played Jazz Night yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Jazz Night so I can make the invoice",
      practice_reminder: "Practice session in 30 min: sweeping technique",
    },
    demoData: {
      clients: [
        { name: "The Blue Note", client_type: "venue", city: "Hoxton, London", default_fee: 150 },
        { name: "Ronnie Scott's", client_type: "venue", city: "Soho, London", default_fee: 200 },
        { name: "Premier Weddings", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Jazz Night @ Blue Note", event_type: "Gig", fee: 150, location: "The Blue Note, Hoxton, London" },
        { title: "Jazz Standards – Ronnie Scott's", event_type: "Gig", fee: 200, location: "Ronnie Scott's, Soho, London" },
        { title: "Wedding Reception – Mayfair", event_type: "Wedding", fee: 1400, location: "Claridge's Hotel, Mayfair, London" }
      ],
      lessons: {
        title: "Guitar Lesson",
        description: "4x Guitar Lessons"
      },
      goals: [
        { title: "Master ii-V-I improvisation", description: "All 12 keys, all positions" },
        { title: "Improve sight-reading speed", description: "Jazz standards and contemporary pieces" },
        { title: "Strengthen fingerpicking", description: "Classical and flamenco techniques" }
      ],
      equipment: [
        { name: "Fender Stratocaster", category: "instrument", condition: "excellent", estimated_value: 1200 },
        { name: "Gibson Les Paul", category: "instrument", condition: "excellent", estimated_value: 1800 },
        { name: "Marshall Amp", category: "amp", condition: "excellent", estimated_value: 650 },
        { name: "Boss TU-3 Tuner Pedal", category: "pedal", condition: "excellent", estimated_value: 80 }
      ]
    }
  },

  // ─── PIANIST / KEYBOARDIST ──────────────────────────────────────────────────
  pianist: {
    id: "pianist",
    label: "Pianist",
    family: PROFESSION_FAMILIES.MUSICIAN,
    verbPlayed: "played",
    workNameSingular: "gig",
    workNamePlural: "gigs",
    practiceTerm: "practice",
    libraryLabel: "Library",
    libraryDesc: "Sheet music, chord charts, lead sheets",
    gearCategories: ["instrument", "stand", "pedal", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Piano Recital at Wigmore Hall",
      aboutMe: "I'm a classical pianist and accompanist. I play at concerts, weddings, and corporate receptions. My lesson rate is £60/hour.",
      practiceItem: "e.g. Hanon exercises, Chopin Etude Op. 10 No. 4…",
      practiceGoal: "e.g. Master Bach Prelude & Fugue in C minor",
      packageName: "e.g. Solo Grand Piano Performance",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "Gig tomorrow: Recital at Wigmore Hall at 19:30",
      gig_load_in: "Call time in 1 hour: Wigmore Hall",
      gig_leave_now: "Leave in 25 min for Wigmore Hall",
      gig_starting_soon: "Starting in 30 min: Piano Recital",
      invoice_not_sent: "You played Wigmore Hall yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Recital so I can make the invoice",
      practice_reminder: "Practice session in 30 min: scales and arpeggios",
    },
    demoData: {
      clients: [
        { name: "Wigmore Hall", client_type: "venue", city: "Marylebone, London", default_fee: 300 },
        { name: "The Savoy Hotel", client_type: "venue", city: "Strand, London", default_fee: 250 },
        { name: "Elegant Events", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Piano Recital – Wigmore Hall", event_type: "Gig", fee: 300, location: "Wigmore Hall, London" },
        { title: "Solo Piano Lounge – Savoy", event_type: "Gig", fee: 250, location: "The Savoy Hotel, Strand" },
        { title: "Wedding Reception – Richmond", event_type: "Wedding", fee: 1200, location: "Pembroke Lodge, Richmond Park" }
      ],
      lessons: {
        title: "Piano Lesson",
        description: "4x Piano Lessons"
      },
      goals: [
        { title: "Master Chopin Nocturne in E-flat", description: "Focus on left-hand rubato and tone" },
        { title: "Improve sight-reading polyphony", description: "Read through Bach 3-part inventions daily" },
        { title: "Develop hand independence", description: "Slow practice of syncopated jazz patterns" }
      ],
      equipment: [
        { name: "Nord Stage 4 Keyboard", category: "instrument", condition: "excellent", estimated_value: 3200 },
        { name: "Yamaha P-515 Portable Piano", category: "instrument", condition: "excellent", estimated_value: 1400 },
        { name: "Heavy Duty Keyboard Stand", category: "stand", condition: "excellent", estimated_value: 120 },
        { name: "Yamaha FC4A Sustain Pedal", category: "pedal", condition: "excellent", estimated_value: 45 }
      ]
    }
  },

  // ─── VIOLINIST / STRING PLAYER ──────────────────────────────────────────────
  violinist: {
    id: "violinist",
    label: "Violinist",
    family: PROFESSION_FAMILIES.MUSICIAN,
    verbPlayed: "played",
    workNameSingular: "gig",
    workNamePlural: "gigs",
    practiceTerm: "practice",
    libraryLabel: "Library",
    libraryDesc: "Sheet music, orchestra parts, scores",
    gearCategories: ["instrument", "bow", "case", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. String Quartet Gig at St Paul's",
      aboutMe: "I'm a professional violinist based in London. I play in orchestras, session strings, and string quartets. My hourly teaching rate is £55.",
      practiceItem: "e.g. Kreutzer Etudes, Schradieck exercises…",
      practiceGoal: "e.g. Learn Bach Partita No. 2 Chaconne",
      packageName: "e.g. Wedding String Duo / Quartet",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "Gig tomorrow: Symphony Concert at 19:00",
      gig_load_in: "Call time in 1 hour: Barbican Centre",
      gig_leave_now: "Leave in 30 min for Barbican Centre",
      gig_starting_soon: "Starting in 30 min: Barbican Concert",
      invoice_not_sent: "You played Barbican Concert yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Barbican Concert so I can make the invoice",
      practice_reminder: "Practice session in 30 min: intonation & bowing",
    },
    demoData: {
      clients: [
        { name: "Royal Philharmonic", client_type: "corporate", city: "London", default_fee: 180 },
        { name: "Barbican Hall", client_type: "venue", city: "London", default_fee: 200 },
        { name: "Celebration Planners", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Symphony Concert – Barbican", event_type: "Gig", fee: 200, location: "Barbican Hall, London" },
        { title: "Session Recording – Abbey Road", event_type: "Session", fee: 400, location: "Abbey Road Studios, London" },
        { title: "Wedding String Quartet – Kensington", event_type: "Wedding", fee: 1600, location: "Kensington Palace Orangery" }
      ],
      lessons: {
        title: "Violin Lesson",
        description: "4x Violin Lessons"
      },
      goals: [
        { title: "Improve shifts to higher positions", description: "Practicing Sevcik Op. 8 shifting exercises" },
        { title: "Master spiccato bowing technique", description: "Isolate bowing arm and relax wrist" },
        { title: "Refine intonation in double stops", description: "Slow practice with drone accompaniment" }
      ],
      equipment: [
        { name: "Italian Violin (1920)", category: "instrument", condition: "excellent", estimated_value: 8500 },
        { name: "Carbon Fiber Bow", category: "bow", condition: "excellent", estimated_value: 900 },
        { name: "BAM Violin Case", category: "case", condition: "excellent", estimated_value: 450 },
        { name: "Pirastro Rosin", category: "accessory", condition: "good", estimated_value: 15 }
      ]
    }
  },

  // ─── SAXOPHONIST ───────────────────────────────────────────────────────────
  saxophonist: {
    id: "saxophonist",
    label: "Saxophonist",
    family: PROFESSION_FAMILIES.MUSICIAN,
    verbPlayed: "played",
    workNameSingular: "gig",
    workNamePlural: "gigs",
    practiceTerm: "practice",
    libraryLabel: "Library",
    libraryDesc: "Lead sheets, charts, transcriptions",
    gearCategories: ["instrument", "mouthpiece", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Jazz Quartet Gig at Vortex",
      aboutMe: "I'm a session saxophonist playing alto and tenor sax. I perform jazz, pop horn sections, and house music improvisation with DJs.",
      practiceItem: "e.g. Long tones, altissimo scale drills…",
      practiceGoal: "e.g. Transcribe Sonny Rollins' St. Thomas solo",
      packageName: "e.g. DJ + Saxophone Live Performance",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "Gig tomorrow: Vortex Quartet at 20:00",
      gig_load_in: "Call time in 1 hour: Vortex Jazz Club",
      gig_leave_now: "Leave in 15 min for Vortex Jazz Club",
      gig_starting_soon: "Starting in 30 min: Vortex Gig",
      invoice_not_sent: "You played Vortex Quartet yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Vortex Gig so I can make the invoice",
      practice_reminder: "Practice session in 30 min: long tones & embouchure",
    },
    demoData: {
      clients: [
        { name: "Vortex Jazz Club", client_type: "venue", city: "Dalston, London", default_fee: 140 },
        { name: "606 Club", client_type: "venue", city: "Chelsea, London", default_fee: 180 },
        { name: "Premier Weddings", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Vortex Quartet Session", event_type: "Gig", fee: 140, location: "Vortex Jazz Club, Dalston" },
        { title: "Evening Session – 606 Club", event_type: "Gig", fee: 180, location: "606 Club, Chelsea, London" },
        { title: "DJ + Sax Club Set – Notting Hill", event_type: "Gig", fee: 600, location: "Private Club, Notting Hill" }
      ],
      lessons: {
        title: "Saxophone Lesson",
        description: "4x Saxophone Lessons"
      },
      goals: [
        { title: "Improve embouchure endurance", description: "30 mins of daily tone matching and overtones" },
        { title: "Expand jazz vocabulary", description: "Learn 5 new bebop patterns in all keys" },
        { title: "Master altissimo register", description: "Practice clean octave jumps up to F#" }
      ],
      equipment: [
        { name: "Selmer Paris Tenor Saxophone", category: "instrument", condition: "excellent", estimated_value: 4800 },
        { name: "Otto Link Metal Mouthpiece", category: "mouthpiece", condition: "excellent", estimated_value: 350 },
        { name: "Vandoren Java Tenor Reeds (x10)", category: "accessory", condition: "good", estimated_value: 38 },
        { name: "Ergonomic Neck Strap", category: "accessory", condition: "excellent", estimated_value: 50 }
      ]
    }
  },

  // ─── DRUMMER ───────────────────────────────────────────────────────────────
  drummer: {
    id: "drummer",
    label: "Drummer",
    family: PROFESSION_FAMILIES.MUSICIAN,
    verbPlayed: "played",
    workNameSingular: "gig",
    workNamePlural: "gigs",
    practiceTerm: "practice",
    libraryLabel: "Library",
    libraryDesc: "Drum charts, lead sheets, setlists",
    gearCategories: ["instrument", "cymbals", "sticks", "hardware", "other"],
    placeholders: {
      eventTitle: "e.g. Rock Show at O2 Academy",
      aboutMe: "I'm a session drummer based in London. I record in studios and tour with pop/rock artists. My rehearsal space rate is £40/hour.",
      practiceItem: "e.g. Paradiddle-diddles, metronome independence…",
      practiceGoal: "e.g. Master polyrhythms in 5/4 and 7/8",
      packageName: "e.g. Session Drum Recording Package",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "Gig tomorrow: O2 Academy Show at 20:30",
      gig_load_in: "Load-in in 2 hours: O2 Academy Islington",
      gig_leave_now: "Leave in 35 min for O2 Academy",
      gig_starting_soon: "Starting in 45 min: Rock Show (Set setup time)",
      invoice_not_sent: "You played O2 Academy yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for O2 Academy Gig so I can make the invoice",
      practice_reminder: "Practice session in 30 min: rudiments on pad",
    },
    demoData: {
      clients: [
        { name: "O2 Academy", client_type: "venue", city: "Islington, London", default_fee: 250 },
        { name: "Air Studios", client_type: "venue", city: "London", default_fee: 500 },
        { name: "Elegant Events", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Rock Show – O2 Academy", event_type: "Gig", fee: 250, location: "O2 Academy, London" },
        { title: "Studio Recording Session", event_type: "Session", fee: 500, location: "Air Studios, Lyndhurst Road" },
        { title: "Corporate Gala – KPMG Awards", event_type: "Corporate", fee: 900, location: "Grosvenor House, Park Lane" }
      ],
      lessons: {
        title: "Drum Lesson",
        description: "4x Drum Lessons"
      },
      goals: [
        { title: "Increase bass drum speed (16ths)", description: "Double-kick coordination and ankle control drills" },
        { title: "Develop dynamic brush control", description: "Vortex jazz trio sweeps and circles" },
        { title: "Build 4-limb independence", description: "Practice Afro-Cuban ostinatos over jazz ride" }
      ],
      equipment: [
        { name: "Gretsch Broadkaster Drum Kit", category: "instrument", condition: "excellent", estimated_value: 2800 },
        { name: "Zildjian K Custom Cymbal Pack", category: "cymbals", condition: "excellent", estimated_value: 1100 },
        { name: "Vic Firth 5A Sticks (x6 pairs)", category: "sticks", condition: "good", estimated_value: 75 },
        { name: "DW 9000 Single Bass Pedal", category: "hardware", condition: "excellent", estimated_value: 380 }
      ]
    }
  },

  // ─── SINGER / VOCALIST ─────────────────────────────────────────────────────
  singer: {
    id: "singer",
    label: "Singer / Vocalist",
    family: PROFESSION_FAMILIES.VOCALIST,
    verbPlayed: "sang",
    workNameSingular: "gig / performance",
    workNamePlural: "gigs / performances",
    practiceTerm: "vocal practice",
    libraryLabel: "Lyrics & Charts",
    libraryDesc: "Lyrics sheets, sheet music, lead sheets",
    gearCategories: ["microphone", "in_ears", "pedal", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Acoustic Set at Jazz Café",
      aboutMe: "I'm a session singer and wedding vocalist. I perform jazz, pop, and soul. My performance rate is £350/gig.",
      practiceItem: "e.g. Lip trills, belt technique, pitch matching…",
      practiceGoal: "e.g. Memorize lyrics for 2-hour set",
      packageName: "e.g. Solo Vocalist + Backing Tracks",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "Gig tomorrow: Acoustic Set at 19:30",
      gig_load_in: "Call time in 1 hour: Jazz Café",
      gig_leave_now: "Leave in 20 min for Jazz Café",
      gig_starting_soon: "Starting in 30 min: Acoustic Lounge Set",
      invoice_not_sent: "You sang at Jazz Café yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Acoustic Set so I can make the invoice",
      practice_reminder: "Vocal warmup in 30 min: breath control & trills",
    },
    demoData: {
      clients: [
        { name: "Jazz Café", client_type: "venue", city: "Camden, London", default_fee: 220 },
        { name: "The Blue Note", client_type: "venue", city: "Hoxton, London", default_fee: 150 },
        { name: "Elegant Events", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Acoustic Set – Jazz Café", event_type: "Gig", fee: 220, location: "Jazz Café, Camden, London" },
        { title: "Jazz Quartet – Blue Note", event_type: "Gig", fee: 150, location: "The Blue Note, Hoxton, London" },
        { title: "Wedding – Surrey Manor", event_type: "Wedding", fee: 1300, location: "Botleys Mansion, Surrey" }
      ],
      lessons: {
        title: "Vocal Lesson",
        description: "4x Vocal Lessons"
      },
      goals: [
        { title: "Expand vocal range by 2 semitones", description: "Daily head-voice and mixed range exercises" },
        { title: "Improve mic control and technique", description: "Practice dynamic distance adjustments during performance" },
        { title: "Memorize 15 setlist lyric sheets", description: "Perform complete songs without lyric lookups" }
      ],
      equipment: [
        { name: "Shure Beta 87A Microphone", category: "microphone", condition: "excellent", estimated_value: 250 },
        { name: "Sennheiser G4 In-Ear Monitors", category: "in_ears", condition: "excellent", estimated_value: 750 },
        { name: "TC Helicon VoiceLive Play Pedal", category: "pedal", condition: "good", estimated_value: 220 },
        { name: "K&M Professional Mic Stand", category: "accessory", condition: "excellent", estimated_value: 65 }
      ]
    }
  },

  // ─── DJ / PRODUCER ──────────────────────────────────────────────────────────
  dj: {
    id: "dj",
    label: "DJ / Producer",
    family: PROFESSION_FAMILIES.DJ,
    verbPlayed: "DJ'd",
    workNameSingular: "set / gig",
    workNamePlural: "sets / gigs",
    practiceTerm: "mix session",
    libraryLabel: "Crates",
    libraryDesc: "Tracklists, cue points, setlists",
    gearCategories: ["controller", "decks", "mixer", "PA system", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Ibiza Sunset Set at Café Mambo",
      aboutMe: "I'm a house DJ and electronic music producer. I perform at clubs, weddings, and corporate festivals. My booking fee is £500/gig.",
      practiceItem: "e.g. Beatmatching, transition timing, scratching…",
      practiceGoal: "e.g. Prepare 3-hour warm-up house set",
      packageName: "e.g. DJ + Saxophone Live Package",
    },
    invoiceFooter: "Thank you for the music.",
    notifications: {
      gig_day_before: "DJ Set tomorrow: Sunset Lounge at 18:30",
      gig_load_in: "Setup & Soundcheck in 1 hour: Sunset Lounge",
      gig_leave_now: "Leave in 20 min for Sunset Lounge",
      gig_starting_soon: "Starting in 30 min: Sunset Lounge Set",
      invoice_not_sent: "You DJ'd Sunset Lounge yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Sunset Lounge so I can make the invoice",
      practice_reminder: "Mix session in 30 min: transition pacing & beatmatching",
    },
    demoData: {
      clients: [
        { name: "Café Mambo", client_type: "venue", city: "San Antonio, Ibiza", default_fee: 500 },
        { name: "Ministry of Sound", client_type: "venue", city: "London", default_fee: 400 },
        { name: "Premier Weddings", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Ibiza Sunset Set @ Café Mambo", event_type: "Gig", fee: 500, location: "Café Mambo, Ibiza" },
        { title: "Late Night DJ Set – Ministry", event_type: "Gig", fee: 400, location: "Ministry of Sound, London" },
        { title: "Wedding DJ Package – Kent", event_type: "Wedding", fee: 1100, location: "Leeds Castle, Kent" }
      ],
      lessons: {
        title: "DJ Coaching Session",
        description: "4x DJ Coaching/Production Lessons"
      },
      goals: [
        { title: "Master harmonic mixing keys", description: "Practice mixing tracks using the Camelot wheel system" },
        { title: "Build summer festival crate", description: "Curate 100 high-energy progressive house tracks" },
        { title: "Refine scratching techniques", description: "Vocal chop cuts and baby scratch precision" }
      ],
      equipment: [
        { name: "Pioneer CDJ-3000 (x2 Decks)", category: "decks", condition: "excellent", estimated_value: 4200 },
        { name: "Pioneer DJM-900NXS2 Mixer", category: "mixer", condition: "excellent", estimated_value: 1900 },
        { name: "Sennheiser HD 25 Headphones", category: "accessory", condition: "excellent", estimated_value: 130 },
        { name: "DJ Flight Case with wheels", category: "accessory", condition: "excellent", estimated_value: 220 }
      ]
    }
  },

  // ─── PHOTOGRAPHER ──────────────────────────────────────────────────────────
  photographer: {
    id: "photographer",
    label: "Photographer",
    family: PROFESSION_FAMILIES.VISUAL_CREATOR,
    verbPlayed: "shot",
    workNameSingular: "shoot",
    workNamePlural: "shoots",
    practiceTerm: "creative session",
    libraryLabel: "Portfolio & Shotlists",
    libraryDesc: "Moodboards, shotlists, reference images",
    gearCategories: ["camera", "lens", "lighting", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Wedding Shoot at Richmond Park",
      aboutMe: "I'm a freelance photographer specializing in weddings and corporate portraits. My day rate is £800.",
      practiceItem: "e.g. Lighting setup, color grading, composition…",
      practiceGoal: "e.g. Experiment with off-camera flash portraits",
      packageName: "e.g. Full Day Wedding Photography",
    },
    invoiceFooter: "Thank you for your business.",
    notifications: {
      gig_day_before: "Shoot tomorrow: Richmond Wedding at 14:00",
      gig_load_in: "Arrival & Gear Setup in 1 hour: Pembroke Lodge",
      gig_leave_now: "Leave in 20 min for Pembroke Lodge",
      gig_starting_soon: "Starting in 30 min: Wedding Shoot",
      invoice_not_sent: "You shot Richmond Wedding yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Richmond Wedding so I can make the invoice",
      practice_reminder: "Creative session in 30 min: off-camera flash setup",
    },
    demoData: {
      clients: [
        { name: "Premier Weddings", client_type: "agent", city: "London" },
        { name: "Goldman Sachs", client_type: "corporate", city: "London", default_fee: 950 },
        { name: "Elegant Events", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "Wedding Shoot @ Richmond Gate", event_type: "Gig", fee: 1250, location: "Pembroke Lodge, Richmond Park" },
        { title: "Corporate Portraits – Barclays", event_type: "Gig", fee: 800, location: "Barclays HQ, London" },
        { title: "Goldman Sachs Event Coverage", event_type: "Gig", fee: 950, location: "Goldman Sachs HQ, London" }
      ],
      lessons: {
        title: "Photography Mentoring",
        description: "4x Photography Mentoring Sessions"
      },
      goals: [
        { title: "Develop dark & moody preset pack", description: "Create 5 consistent Lightroom presets for wedding events" },
        { title: "Practice three-point studio lighting", description: "Shoot portraits with model references" },
        { title: "Optimize file backup archive", description: "Backup raw footage and tag metadata for 2025 library" }
      ],
      equipment: [
        { name: "Sony a7R V Camera Body", category: "camera", condition: "excellent", estimated_value: 3500 },
        { name: "Sony 24-70mm f/2.8 GM II Lens", category: "lens", condition: "excellent", estimated_value: 2100 },
        { name: "Godox AD200 Pro Flash (x2)", category: "lighting", condition: "excellent", estimated_value: 600 },
        { name: "Peak Design Carbon Tripod", category: "accessory", condition: "good", estimated_value: 550 }
      ]
    }
  },

  // ─── VIDEOGRAPHER ──────────────────────────────────────────────────────────
  videographer: {
    id: "videographer",
    label: "Videographer",
    family: PROFESSION_FAMILIES.VISUAL_CREATOR,
    verbPlayed: "shot",
    workNameSingular: "shoot / video production",
    workNamePlural: "shoots / productions",
    practiceTerm: "creative session",
    libraryLabel: "Storyboards & LUTs",
    libraryDesc: "Storyboards, scripts, visual references",
    gearCategories: ["camera", "lens", "audio", "rig_gimbal", "other"],
    placeholders: {
      eventTitle: "e.g. Promo Video Shoot at Abbey Road",
      aboutMe: "I'm a commercial videographer and video editor. I shoot music videos, weddings, and corporate promos. My day rate is £900.",
      practiceItem: "e.g. Color grading LUT study, camera stabilizer pacing…",
      practiceGoal: "e.g. Practice gimbal panning and tracking",
      packageName: "e.g. 2-Minute Corporate Promo Video",
    },
    invoiceFooter: "Thank you for your business.",
    notifications: {
      gig_day_before: "Promo Shoot tomorrow: Abbey Road at 10:00",
      gig_load_in: "Arrival & Camera Rigging in 1 hour: Abbey Road Studios",
      gig_leave_now: "Leave in 25 min for Abbey Road Studios",
      gig_starting_soon: "Starting in 30 min: Video Shoot",
      invoice_not_sent: "You shot Video Promo yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Video Promo so I can make the invoice",
      practice_reminder: "Creative session in 30 min: gimbal tracking drills",
    },
    demoData: {
      clients: [
        { name: "McKinsey", client_type: "corporate", city: "London", default_fee: 1000 },
        { name: "KPMG", client_type: "corporate", city: "London", default_fee: 900 },
        { name: "Premier Weddings", client_type: "agent", city: "London" }
      ],
      gigs: [
        { title: "McKinsey Promo Shoot", event_type: "Gig", fee: 1000, location: "The Ritz, London" },
        { title: "Recording Video – Abbey Road", event_type: "Session", fee: 600, location: "Abbey Road Studios, London" },
        { title: "Wedding Video Package – Mayfair", event_type: "Wedding", fee: 1400, location: "Claridge's Hotel, Mayfair" }
      ],
      lessons: {
        title: "Video Editing Mentoring",
        description: "4x Video Editing coaching sessions"
      },
      goals: [
        { title: "Master DaVinci Resolve color grading", description: "Color-matching raw S-log footage" },
        { title: "Develop transition template pack", description: "Save 10 fast zoom and whip transition macros" },
        { title: "Optimize sound design layering", description: "Study ambient atmosphere overlay techniques" }
      ],
      equipment: [
        { name: "Sony FX3 Cinema Line Camera", category: "camera", condition: "excellent", estimated_value: 3900 },
        { name: "Sony 16-35mm f/2.8 GM Lens", category: "lens", condition: "excellent", estimated_value: 1900 },
        { name: "DJI Ronin RS 3 Pro Gimbal", category: "rig_gimbal", condition: "excellent", estimated_value: 750 },
        { name: "Sennheiser MKE 600 Shotgun Mic", category: "audio", condition: "excellent", estimated_value: 320 }
      ]
    }
  },

  // ─── TEACHER / INSTRUCTOR ──────────────────────────────────────────────────
  teacher: {
    id: "teacher",
    label: "Teacher / Instructor",
    family: PROFESSION_FAMILIES.TEACHER,
    verbPlayed: "taught",
    workNameSingular: "lesson / class",
    workNamePlural: "lessons / classes",
    practiceTerm: "lesson planning",
    libraryLabel: "Syllabus & Materials",
    libraryDesc: "Teaching materials, exercises, syllabi",
    gearCategories: ["instrument", "classroom_gear", "accessory", "other"],
    placeholders: {
      eventTitle: "e.g. Masterclass Workshop at Royal Academy",
      aboutMe: "I'm a private music instructor and workshop teacher. I teach both children and adults. My hourly rate is £45.",
      practiceItem: "e.g. Lesson planning, sheet music grading…",
      practiceGoal: "e.g. Update curriculum for intermediate grades",
      packageName: "e.g. 10x Lesson Block Package",
    },
    invoiceFooter: "Thank you for choosing my tuition.",
    notifications: {
      gig_day_before: "Class tomorrow: Masterclass Workshop at 16:00",
      gig_load_in: "Arrival & Classroom Setup in 45 min: Royal Academy",
      gig_leave_now: "Leave in 20 min for Royal Academy",
      gig_starting_soon: "Starting in 15 min: Music Workshop",
      invoice_not_sent: "You taught Masterclass yesterday. Send invoice?",
      gig_needs_fee: "I need the fee for Masterclass Workshop so I can make the invoice",
      practice_reminder: "Lesson planning in 30 min: intermediate exercises",
    },
    demoData: {
      clients: [
        { name: "Royal Academy of Music", client_type: "venue", city: "London", default_fee: 150 },
        { name: "Sophie Williams", client_type: "student", city: "Home Studio", default_fee: 45 },
        { name: "Ava Martinez", client_type: "student", city: "Home Studio", default_fee: 45 }
      ],
      gigs: [
        { title: "Music Theory Workshop", event_type: "Gig", fee: 150, location: "Royal Academy, London" },
        { title: "Weekly Lessons Sophie Williams", event_type: "Lesson", fee: 45, location: "Home Studio" },
        { title: "Weekly Lessons Ava Martinez", event_type: "Lesson", fee: 45, location: "Home Studio" }
      ],
      lessons: {
        title: "Instrument Tuition Lesson",
        description: "4x Tuition Lessons"
      },
      goals: [
        { title: "Complete study plans for student recitals", description: "Detail pieces for 5 core students" },
        { title: "Sourcing easy jazz arrangements", description: "Collect 10 pieces graded for beginner piano/guitar" },
        { title: "Record reference accompaniment tracks", description: "Audio files for students' play-along practice" }
      ],
      equipment: [
        { name: "Student Keyboard Instrument", category: "instrument", condition: "good", estimated_value: 500 },
        { name: "Magnetic Whiteboard & Staves", category: "classroom_gear", condition: "excellent", estimated_value: 80 },
        { name: "Adjustable Music Stand (x2)", category: "accessory", condition: "good", estimated_value: 60 },
        { name: "Apple iPad Air (teaching charts)", category: "classroom_gear", condition: "excellent", estimated_value: 590 }
      ]
    }
  }
};
