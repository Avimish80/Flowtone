import { format, addDays, subDays, addWeeks } from "date-fns";

/**
 * Generate a complete, busy musician dataset.
 * Writes directly to the active signed-in account in Supabase.
 *
 * Generates:
 * - 20 students (15 weekly, 5 bi-weekly) with 8 weeks back + 16 weeks forward of lessons
 * - 104 gigs spread across Jan 2025 – May 2027
 * - Invoices + payments for past events
 * - Practice goals + sessions
 * - Equipment
 */

function uid() {
  return crypto.randomUUID();
}

function ts() {
  return new Date().toISOString();
}

function d(date) {
  return format(date, "yyyy-MM-dd");
}

const TODAY = new Date();

const studentDefs = [
  { name: "Sophie Williams",  email: "sophie@example.com",   phone: "07700 001001", fee: 45, day: 1 /* Mon */ },
  { name: "James Chen",       email: "james@example.com",    phone: "07700 001002", fee: 50, day: 1 },
  { name: "Liam Harris",      email: "liam@example.com",     phone: "07700 001003", fee: 50, day: 2 },
  { name: "Ava Martinez",     email: "ava@example.com",      phone: "07700 001004", fee: 45, day: 2 },
  { name: "Noah Williams",    email: "noah@example.com",     phone: "07700 001005", fee: 40, day: 3 },
  { name: "Zoe Thompson",     email: "zoe@example.com",      phone: "07700 001006", fee: 50, day: 3 },
  { name: "Oliver Johnson",   email: "oliver@example.com",   phone: "07700 001007", fee: 45, day: 4 },
  { name: "Emma Foster",      email: "emma@example.com",     phone: "07700 001008", fee: 50, day: 4 },
  { name: "Jake Thompson",    email: "jake@example.com",     phone: "07700 001009", fee: 40, day: 5 },
  { name: "Isabella Gray",    email: "isabella@example.com", phone: "07700 001010", fee: 50, day: 5 },
  { name: "Lucas Brown",      email: "lucas@example.com",    phone: "07700 001011", fee: 45, day: 6 },
  { name: "Mia Wilson",       email: "mia@example.com",      phone: "07700 001012", fee: 50, day: 6 },
  { name: "Ethan Davis",      email: "ethan@example.com",    phone: "07700 001013", fee: 40, day: 0 },
  { name: "Charlotte Lee",    email: "charlotte@example.com",phone: "07700 001014", fee: 50, day: 0 },
  { name: "Mason Taylor",     email: "mason@example.com",    phone: "07700 001015", fee: 45, day: 1 },
  // bi-weekly
  { name: "Lily Anderson",    email: "lily@example.com",     phone: "07700 001016", fee: 50, day: 2, biweekly: true },
  { name: "Daniel Roberts",   email: "daniel@example.com",   phone: "07700 001017", fee: 50, day: 3, biweekly: true },
  { name: "Amelia King",      email: "amelia@example.com",   phone: "07700 001018", fee: 45, day: 4, biweekly: true },
  { name: "Benjamin Scott",   email: "benjamin@example.com", phone: "07700 001019", fee: 50, day: 5, biweekly: true },
  { name: "Harper Green",     email: "harper@example.com",   phone: "07700 001020", fee: 45, day: 6, biweekly: true },
];

const venueList = [
  { name: "The Blue Note",        email: "bookings@bluenote.com",       city: "Hoxton, London",       fee: 150 },
  { name: "Ronnie Scott's",       email: "bookings@ronniescotts.com",   city: "Soho, London",         fee: 200 },
  { name: "Pizza Express Jazz",   email: "jazz@pizzaexpress.com",       city: "Dean Street, London",  fee: 120 },
  { name: "606 Club",             email: "bookings@606club.com",        city: "Chelsea, London",      fee: 180 },
  { name: "Vortex Jazz Club",     email: "info@vortexjazz.co.uk",      city: "Dalston, London",      fee: 140 },
];

const corporateList = [
  { name: "Goldman Sachs",  email: "events@gs.com",           city: "Canary Wharf, London", fee: 950 },
  { name: "Barclays",       email: "corporate@barclays.com",  city: "London",               fee: 800 },
  { name: "KPMG",           email: "events@kpmg.com",         city: "London",               fee: 900 },
  { name: "Deloitte",       email: "events@deloitte.com",     city: "London",               fee: 850 },
  { name: "McKinsey",       email: "events@mckinsey.com",     city: "London",               fee: 1000 },
];

const agentList = [
  { name: "Premier Weddings",      email: "bookings@premierweddings.com",      city: "London" },
  { name: "Elegant Events",        email: "info@elegantevents.com",            city: "London" },
  { name: "Celebration Planners",  email: "bookings@celebrationplanners.com",  city: "London" },
];

const GIG_TITLES = [
  ["Wedding Reception – Mayfair",        "Wedding",     1400, "Premier Weddings",     "Claridge's Hotel, Mayfair, London"],
  ["Wedding Reception – Richmond",       "Wedding",     1250, "Elegant Events",       "Pembroke Lodge, Richmond Park"],
  ["Wedding – Kensington",               "Wedding",     1600, "Celebration Planners", "Kensington Palace Orangery, London"],
  ["Wedding – Surrey",                   "Wedding",     1300, "Premier Weddings",     "Botleys Mansion, Surrey"],
  ["Wedding – Kent",                     "Wedding",     1100, "Elegant Events",       "Leeds Castle, Kent"],
  ["Wedding – Chelsea",                  "Wedding",     1450, "Celebration Planners", "Chelsea Old Town Hall, London"],
  ["Wedding – Oxfordshire",              "Wedding",     1200, "Premier Weddings",     "Blenheim Palace, Oxfordshire"],
  ["Wedding – Hampshire",                "Wedding",     1350, "Elegant Events",       "Braiswick Farmhouse, Hampshire"],
  ["Goldman Sachs Summer Party",         "Corporate",    950, "Goldman Sachs",        "Goldman Sachs HQ, Canary Wharf"],
  ["Barclays Annual Dinner",             "Corporate",    800, "Barclays",             "Barclays HQ, London"],
  ["KPMG Awards Night",                  "Corporate",    900, "KPMG",                 "Grosvenor House, Park Lane"],
  ["Deloitte Client Reception",          "Corporate",    850, "Deloitte",             "Deloitte HQ, London"],
  ["McKinsey Strategy Summit",           "Corporate",   1000, "McKinsey",             "The Shard, London"],
  ["Goldman Sachs Christmas Party",      "Corporate",    950, "Goldman Sachs",        "Goldman Sachs HQ, Canary Wharf"],
  ["Barclays Tech Conference",           "Corporate",    750, "Barclays",             "ExCeL London"],
  ["KPMG Leadership Summit",             "Corporate",    900, "KPMG",                 "The Dorchester, London"],
  ["Deloitte Innovation Awards",         "Corporate",    800, "Deloitte",             "Royal Lancaster London"],
  ["McKinsey Partner Dinner",            "Corporate",   1000, "McKinsey",             "The Ritz, London"],
  ["Barclays Gala Evening",              "Corporate",    850, "Barclays",             "Guildhall, London"],
  ["Goldman Sachs Charity Gala",         "Corporate",    950, "Goldman Sachs",        "Natural History Museum, London"],
  ["Deloitte Summer Party",              "Corporate",    800, "Deloitte",             "Battersea Power Station, London"],
  ["McKinsey Annual Dinner",             "Corporate",   1000, "McKinsey",             "Mandarin Oriental, London"],
  ["Jazz Night @ Blue Note",             "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Jazz Quartet – Blue Note",           "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Late Night Jazz – Blue Note",        "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Sunday Session – Blue Note",         "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Bank Holiday Special – Blue Note",   "Gig",          200, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Jazz Standards – Ronnie Scott's",    "Gig",          200, "Ronnie Scott's",       "Ronnie Scott's, Soho, London"],
  ["Quartet Night – Ronnie Scott's",     "Gig",          200, "Ronnie Scott's",       "Ronnie Scott's, Soho, London"],
  ["Late Show – Ronnie Scott's",         "Gig",          220, "Ronnie Scott's",       "Ronnie Scott's, Soho, London"],
  ["Jazz Brunch – Pizza Express",        "Gig",          120, "Pizza Express Jazz",   "Pizza Express Jazz Club, Dean Street"],
  ["Sunday Jazz – Pizza Express",        "Gig",          120, "Pizza Express Jazz",   "Pizza Express Jazz Club, Dean Street"],
  ["Evening Session – 606 Club",         "Gig",          180, "606 Club",             "606 Club, Chelsea, London"],
  ["Late Night – 606 Club",              "Gig",          180, "606 Club",             "606 Club, Chelsea, London"],
  ["Vortex Jazz Night",                  "Gig",          140, "Vortex Jazz Club",     "Vortex Jazz Club, Dalston"],
  ["Vortex Quartet Session",             "Gig",          140, "Vortex Jazz Club",     "Vortex Jazz Club, Dalston"],
  ["Blue Note Residency – Week 1",       "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Blue Note Residency – Week 2",       "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Blue Note Residency – Week 3",       "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Blue Note Residency – Week 4",       "Gig",          150, "The Blue Note",        "The Blue Note, Hoxton, London"],
  ["Private Party – Notting Hill",       "Gig",          600, "Premier Weddings",     "Private Residence, Notting Hill"],
  ["Private Party – Mayfair",            "Gig",          700, "Elegant Events",       "Private Residence, Mayfair"],
  ["Private Party – Kensington",         "Gig",          650, "Celebration Planners", "Private Residence, Kensington"],
  ["Birthday Party – Hampstead",         "Gig",          500, "Premier Weddings",     "Private Residence, Hampstead"],
  ["Garden Party – Richmond",            "Gig",          550, "Elegant Events",       "Private Garden, Richmond"],
  ["Studio Session – Air Studios",       "Session",      500, "Goldman Sachs",        "Air Studios, Lyndhurst Road, London"],
  ["Recording – Abbey Road",             "Session",      600, "Barclays",             "Abbey Road Studios, London"],
  ["Session – RAK Studios",              "Session",      450, "KPMG",                 "RAK Studios, London"],
  ["Demo Recording",                     "Session",      400, "Deloitte",             "Home Studio"],
  ["Overdubs – Metropolis Studios",      "Session",      550, "McKinsey",             "Metropolis Studios, London"],
  ["Rehearsal Recording",                "Session",      350, "Goldman Sachs",        "Strongroom Studios, London"],
  ["Wilderness Festival",                "Festival",     350, "Elegant Events",       "Cornbury Park, Oxfordshire"],
  ["Green Man Festival",                 "Festival",     400, "Premier Weddings",     "Brecon Beacons, Wales"],
  ["Ronnie Scott's Summer Fest",         "Festival",     300, "Ronnie Scott's",       "Ronnie Scott's, Soho, London"],
  ["Love Supreme Jazz Festival",         "Festival",     450, "The Blue Note",        "Glynde Place, East Sussex"],
  ["EFG London Jazz Festival",           "Festival",     500, "Vortex Jazz Club",     "Various venues, London"],
  ["Cheltenham Jazz Festival",           "Festival",     380, "606 Club",             "Cheltenham Town Centre"],
];

// Spread gigs across Jan 2025 – May 2027
// Seed dates so they're predictably spread, not random (avoids clustering)
function spreadDates(count, startDate, endDateObj) {
  const totalDays = Math.floor((endDateObj - startDate) / 86400000);
  const step = Math.floor(totalDays / count);
  const dates = [];
  for (let i = 0; i < count; i++) {
    // spread + small offset so not all exactly same day-of-week
    dates.push(addDays(startDate, i * step + (i % 7)));
  }
  return dates;
}

export async function generateBusyMusicianData(appClient) {
  const startDate = new Date(2025, 0, 6);  // Jan 6, 2025 (Monday)
  const endDate   = new Date(2027, 4, 31); // May 31, 2027

  // ── 1. BUILD ALL DATA IN MEMORY ────────────────────────────────────
  const clientRecords    = [];
  const eventRecords     = [];
  const documentRecords  = [];
  const paymentRecords   = [];
  const goalRecords      = [];
  const sessionRecords   = [];
  const equipmentRecords = [];

  // ── 1a. Clients ────────────────────────────────────────────────────
  const clientMap = {}; // name → id

  for (const s of studentDefs) {
    const id = uid();
    clientMap[s.name] = id;
    clientRecords.push({
      id, created_at: ts(), updated_at: ts(),
      name: s.name, email: s.email, phone: s.phone,
      client_type: "student",
      default_fee: s.fee,
      default_payment_terms_days: 14,
      emails: [s.email], phones: [s.phone],
    });
  }
  for (const v of venueList) {
    const id = uid();
    clientMap[v.name] = id;
    clientRecords.push({
      id, created_at: ts(), updated_at: ts(),
      name: v.name, email: v.email, client_type: "venue",
      default_fee: v.fee, city: v.city,
      emails: [v.email], phones: [],
    });
  }
  for (const c of corporateList) {
    const id = uid();
    clientMap[c.name] = id;
    clientRecords.push({
      id, created_at: ts(), updated_at: ts(),
      name: c.name, email: c.email, client_type: "corporate",
      default_fee: c.fee, city: c.city,
      emails: [c.email], phones: [],
    });
  }
  for (const a of agentList) {
    const id = uid();
    clientMap[a.name] = id;
    clientRecords.push({
      id, created_at: ts(), updated_at: ts(),
      name: a.name, email: a.email, client_type: "agent",
      city: a.city, emails: [a.email], phones: [],
    });
  }

  // ── 1b. Invoice counter ────────────────────────────────────────────
  let invNum = 1;
  function nextInvNum() {
    return `INV-${String(invNum++).padStart(4, "0")}`;
  }

  // ── 1c. Lessons ────────────────────────────────────────────────────
  // 8 weeks back + 16 weeks forward = 24 weeks per student
  const LESSON_START = subDays(TODAY, 56);  // 8 weeks ago
  const LESSON_END   = addDays(TODAY, 112); // 16 weeks from now

  for (const s of studentDefs) {
    const clientId = clientMap[s.name];
    const times = ["10:00", "11:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
    const startTime = times[studentDefs.indexOf(s) % times.length];
    const endHour = parseInt(startTime) + 1;
    const endTime = `${String(endHour).padStart(2,"0")}:00`;

    // Find first occurrence of the lesson day on or after LESSON_START
    let cur = new Date(LESSON_START);
    while (cur.getDay() !== s.day) cur = addDays(cur, 1);

    let lessonNum = 0;
    let monthlyInvItems = []; // accumulate 4 lessons per invoice
    let monthlyInvStart = new Date(cur);

    while (cur <= LESSON_END) {
      const isPast = cur <= TODAY;
      const eventId = uid();
      eventRecords.push({
        id: eventId, created_at: ts(), updated_at: ts(),
        title: `${s.name} – Guitar Lesson`,
        event_type: "Lesson",
        date: d(cur),
        start_time: startTime,
        end_time: endTime,
        status: isPast ? "completed" : "confirmed",
        client_id: clientId,
        location_address: "Home Studio",
        base_price: s.fee,
        total_price: s.fee,
        currency: "GBP",
        adjustments: [],
        equipment_checklist: [],
      });

      lessonNum++;
      monthlyInvItems.push({ date: d(cur), fee: s.fee });

      // Every 4 lessons create a monthly invoice
      if (monthlyInvItems.length === 4) {
        const isPaidMonth = addDays(cur, 14) < TODAY;
        const invId = uid();
        const total = s.fee * 4;
        documentRecords.push({
          id: invId, created_at: ts(), updated_at: ts(),
          document_type: "invoice",
          document_number: nextInvNum(),
          title: `Lessons – ${s.name}`,
          client_id: clientId,
          work_event_id: eventId,
          is_standalone: false,
          status: isPaidMonth ? "paid" : (isPast ? "sent" : "draft"),
          currency: "GBP",
          line_items: [{ description: "4x Guitar Lessons", quantity: 4, unit_price: s.fee, total }],
          subtotal: total, discount_amount: 0, tax_amount: 0, total,
          due_date: d(addDays(cur, 14)),
          paid_date: isPaidMonth ? d(addDays(cur, 7)) : null,
          paid_amount: isPaidMonth ? total : 0,
          notes: "",
        });

        if (isPaidMonth) {
          paymentRecords.push({
            id: uid(), created_at: ts(), updated_at: ts(),
            document_id: invId,
            amount: total,
            payment_date: d(addDays(cur, 7)),
            payment_method: "bank_transfer",
            notes: "",
          });
        }
        monthlyInvItems = [];
        monthlyInvStart = addDays(cur, s.biweekly ? 14 : 7);
      }

      cur = addDays(cur, s.biweekly ? 14 : 7);
    }
  }

  // ── 1d. Gigs ───────────────────────────────────────────────────────
  const gigDates = spreadDates(GIG_TITLES.length, startDate, endDate);

  GIG_TITLES.forEach(([title, eventType, fee, clientName, location], i) => {
    const gigDate = gigDates[i] || addDays(startDate, i * 8);
    if (gigDate > endDate) return;

    const clientId = clientMap[clientName] || "";
    const isPast   = gigDate <= TODAY;
    const eventId  = uid();

    eventRecords.push({
      id: eventId, created_at: ts(), updated_at: ts(),
      title,
      event_type: eventType === "Gig" ? "Gig" : eventType,
      date: d(gigDate),
      start_time: "19:30",
      end_time:   "23:00",
      status: isPast ? "completed" : "confirmed",
      client_id: clientId,
      location_address: location,
      base_price: fee,
      total_price: fee,
      currency: "GBP",
      adjustments: [],
      equipment_checklist: [],
    });

    const isPaid = addDays(gigDate, 7) < TODAY;
    const invId  = uid();
    documentRecords.push({
      id: invId, created_at: ts(), updated_at: ts(),
      document_type: "invoice",
      document_number: nextInvNum(),
      title,
      client_id: clientId,
      work_event_id: eventId,
      is_standalone: false,
      status: isPaid ? "paid" : (isPast ? "sent" : (gigDate < addDays(TODAY, 30) ? "sent" : "draft")),
      currency: "GBP",
      line_items: [{ description: title, quantity: 1, unit_price: fee, total: fee }],
      subtotal: fee, discount_amount: 0, tax_amount: 0, total: fee,
      due_date: d(addDays(gigDate, 7)),
      paid_date: isPaid ? d(addDays(gigDate, 5)) : null,
      paid_amount: isPaid ? fee : 0,
      notes: "",
    });

    if (isPaid) {
      paymentRecords.push({
        id: uid(), created_at: ts(), updated_at: ts(),
        document_id: invId,
        amount: fee,
        payment_date: d(addDays(gigDate, 5)),
        payment_method: "bank_transfer",
        notes: "",
      });
    }
  });

  // ── 1e. Practice goals ─────────────────────────────────────────────
  const goalDefs = [
    { title: "Master ii-V-I improvisation",      description: "All 12 keys, all positions" },
    { title: "Improve sight-reading speed",       description: "Jazz standards and contemporary pieces" },
    { title: "Develop tone and dynamics",         description: "Work on expression across all registers" },
    { title: "Expand repertoire to 60 standards", description: "Learn 10 new standards per month" },
    { title: "Strengthen fingerpicking",          description: "Classical and flamenco techniques" },
  ];
  for (const g of goalDefs) {
    goalRecords.push({
      id: uid(), created_at: ts(), updated_at: ts(),
      title: g.title, description: g.description, completed: false,
    });
  }

  // ── 1f. Practice sessions (every 3 days for 6 months back) ────────
  let practiceDate = subDays(TODAY, 180);
  while (practiceDate <= TODAY) {
    const randomGoal = goalRecords[Math.floor(Math.random() * goalRecords.length)];
    sessionRecords.push({
      id: uid(), created_at: ts(), updated_at: ts(),
      date: d(practiceDate),
      duration_minutes: 60 + Math.floor(Math.random() * 60),
      notes: "",
      goal_id: randomGoal?.id || null,
      energy_rating: 2 + Math.floor(Math.random() * 4),
      items: [],
    });
    practiceDate = addDays(practiceDate, 3);
  }

  // ── 1g. Equipment ─────────────────────────────────────────────────
  const equipDefs = [
    { name: "Fender Stratocaster",    category: "Guitar",      condition: "excellent" },
    { name: "Gibson Les Paul",        category: "Guitar",      condition: "excellent" },
    { name: "Yamaha Classical",       category: "Guitar",      condition: "good" },
    { name: "Marshall Amp",           category: "Amplifier",   condition: "excellent" },
    { name: "Shure SM58 Mic",         category: "Microphone",  condition: "excellent" },
    { name: "Behringer Mixer",        category: "Mixer",       condition: "good" },
    { name: "Music Stand",            category: "Accessory",   condition: "good" },
    { name: "Guitar Case",            category: "Case",        condition: "excellent" },
    { name: "Patch Cables (x6)",      category: "Cable",       condition: "good" },
    { name: "Boss TU-3 Tuner Pedal",  category: "Pedal",       condition: "excellent" },
  ];
  for (const e of equipDefs) {
    equipmentRecords.push({ id: uid(), created_at: ts(), updated_at: ts(), ...e });
  }

  // ── 2. WRITE ALL TO THE SIGNED-IN CLOUD ACCOUNT ───────────────────
  await appClient.entities.Client.createMany(clientRecords);
  await appClient.entities.WorkEvent.createMany(eventRecords);
  await appClient.entities.Document.createMany(documentRecords);
  await appClient.entities.Payment.createMany(paymentRecords);
  await appClient.entities.PracticeGoal.createMany(goalRecords);
  await appClient.entities.PracticeSession.createMany(sessionRecords);
  await appClient.entities.Equipment.createMany(equipmentRecords);

  const existingSettings = await appClient.entities.AppSettings.list();
  if (existingSettings[0]) {
    await appClient.entities.AppSettings.update(existingSettings[0].id, {
      invoice_number_next: invNum,
    });
  } else {
    await appClient.entities.AppSettings.create({
      invoice_number_prefix: "INV-",
      invoice_number_next: invNum,
      estimate_number_prefix: "EST-",
      estimate_number_next: 1,
      currency: "GBP",
      default_currency: "GBP",
      default_nav_app: "google_maps",
      default_payment_terms_days: 30,
      default_tax_rate: 0,
      invoice_template: 1,
      notification_level: "standard",
      tax_rate: 0,
      tax_year_start_month: 4,
    });
  }

  return {
    clients:   clientRecords.length,
    events:    eventRecords.length,
    invoices:  documentRecords.length,
    payments:  paymentRecords.length,
    practice:  sessionRecords.length,
    equipment: equipmentRecords.length,
  };
}
