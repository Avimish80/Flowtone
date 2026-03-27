import { format, addDays, startOfDay } from "date-fns";

/**
 * Generate a complete, busy musician dataset from Jan 2025 to May 2027.
 * Includes:
 * - 100+ gigs with varied types and prices
 * - 20 students (15 weekly, 5 bi-weekly) for lessons
 * - Linked invoices and payment history
 * - Practice sessions and goals
 * - Equipment and charts
 */

const studentNames = [
  { name: "Sophie Williams", email: "sophie@example.com", phone: "07700 001001", type: "student", fee: 45, frequency: "weekly" },
  { name: "James Chen", email: "james@example.com", phone: "07700 001002", type: "student", fee: 50, frequency: "weekly" },
  { name: "Liam Harris", email: "liam@example.com", phone: "07700 001003", type: "student", fee: 50, frequency: "weekly" },
  { name: "Ava Martinez", email: "ava@example.com", phone: "07700 001004", type: "student", fee: 45, frequency: "weekly" },
  { name: "Noah Williams", email: "noah@example.com", phone: "07700 001005", type: "student", fee: 40, frequency: "weekly" },
  { name: "Zoe Thompson", email: "zoe@example.com", phone: "07700 001006", type: "student", fee: 50, frequency: "weekly" },
  { name: "Oliver Johnson", email: "oliver@example.com", phone: "07700 001007", type: "student", fee: 45, frequency: "weekly" },
  { name: "Emma Foster", email: "emma@example.com", phone: "07700 001008", type: "student", fee: 50, frequency: "weekly" },
  { name: "Jake Thompson", email: "jake@example.com", phone: "07700 001009", type: "student", fee: 40, frequency: "weekly" },
  { name: "Isabella Gray", email: "isabella@example.com", phone: "07700 001010", type: "student", fee: 50, frequency: "weekly" },
  { name: "Lucas Brown", email: "lucas@example.com", phone: "07700 001011", type: "student", fee: 45, frequency: "weekly" },
  { name: "Mia Wilson", email: "mia@example.com", phone: "07700 001012", type: "student", fee: 50, frequency: "weekly" },
  { name: "Ethan Davis", email: "ethan@example.com", phone: "07700 001013", type: "student", fee: 40, frequency: "weekly" },
  { name: "Charlotte Lee", email: "charlotte@example.com", phone: "07700 001014", type: "student", fee: 50, frequency: "weekly" },
  { name: "Mason Taylor", email: "mason@example.com", phone: "07700 001015", type: "student", fee: 45, frequency: "weekly" },
  // Bi-weekly students
  { name: "Lily Anderson", email: "lily@example.com", phone: "07700 001016", type: "student", fee: 50, frequency: "biweekly" },
  { name: "Daniel Roberts", email: "daniel@example.com", phone: "07700 001017", type: "student", fee: 50, frequency: "biweekly" },
  { name: "Amelia King", email: "amelia@example.com", phone: "07700 001018", type: "student", fee: 45, frequency: "biweekly" },
  { name: "Benjamin Scott", email: "benjamin@example.com", phone: "07700 001019", type: "student", fee: 50, frequency: "biweekly" },
  { name: "Harper Green", email: "harper@example.com", phone: "07700 001020", type: "student", fee: 45, frequency: "biweekly" },
];

const venueClients = [
  { name: "The Blue Note", email: "bookings@bluenote.com", type: "venue", fee: 150, address: "Hoxton, London" },
  { name: "Ronnie Scott's", email: "bookings@ronniescotts.com", type: "venue", fee: 200, address: "Soho, London" },
  { name: "Pizza Express Jazz Club", email: "jazz@pizzaexpress.com", type: "venue", fee: 120, address: "Dean Street, London" },
  { name: "606 Club", email: "bookings@606club.com", type: "venue", fee: 180, address: "Chelsea, London" },
  { name: "Vortex Jazz Club", email: "info@vortexjazz.co.uk", type: "venue", fee: 140, address: "Dalston, London" },
];

const corporateClients = [
  { name: "Goldman Sachs", email: "events@gs.com", type: "corporate", fee: 950, address: "Canary Wharf, London" },
  { name: "Barclays", email: "corporate@barclays.com", type: "corporate", fee: 800, address: "London" },
  { name: "KPMG", email: "events@kpmg.com", type: "corporate", fee: 900, address: "London" },
  { name: "Deloitte", email: "events@deloitte.com", type: "corporate", fee: 850, address: "London" },
  { name: "McKinsey", email: "events@mckinsey.com", type: "corporate", fee: 1000, address: "London" },
];

const weddingAgencies = [
  { name: "Premier Weddings", email: "bookings@premierweddings.com", type: "agent", fee: 0, address: "London" },
  { name: "Elegant Events", email: "info@elegantevents.com", type: "agent", fee: 0, address: "London" },
  { name: "Celebration Planners", email: "bookings@celebrationplanners.com", type: "agent", fee: 0, address: "London" },
];

export async function generateBusyMusicianData(appClient) {
  try {
    const startDate = new Date(2025, 0, 1); // Jan 1, 2025
    const endDate = new Date(2027, 4, 31);  // May 31, 2027

    // Create clients
    const clients = [];
    for (const s of studentNames) {
      const c = await appClient.entities.Client.create({
        name: s.name,
        email: s.email,
        phone: s.phone,
        client_type: "student",
        default_fee: s.fee,
        default_payment_terms_days: 14,
      });
      clients.push(c);
    }
    for (const v of venueClients) {
      const c = await appClient.entities.Client.create({
        name: v.name,
        email: v.email,
        client_type: "venue",
        default_fee: v.fee,
        city: v.address,
      });
      clients.push(c);
    }
    for (const corp of corporateClients) {
      const c = await appClient.entities.Client.create({
        name: corp.name,
        email: corp.email,
        client_type: "corporate",
        default_fee: corp.fee,
        city: corp.address,
      });
      clients.push(c);
    }
    for (const w of weddingAgencies) {
      const c = await appClient.entities.Client.create({
        name: w.name,
        email: w.email,
        client_type: "agent",
      });
      clients.push(c);
    }

    // Helper: generate gigs and lessons
    const events = [];
    const invoices = [];
    const payments = [];

    // === LESSONS (recurring weekly / bi-weekly) ===
    for (const student of studentNames) {
      const clientRec = clients.find(c => c.name === student.name);
      if (!clientRec) continue;

      let currentDate = new Date(startDate);
      let lessonCount = 0;
      while (currentDate <= endDate) {
        // Create lesson event
        const e = await appClient.entities.WorkEvent.create({
          title: `${student.name} – Guitar Lesson`,
          event_type: "Lesson",
          date: format(currentDate, "yyyy-MM-dd"),
          start_time: "18:00",
          end_time: "19:00",
          status: currentDate <= new Date() ? "completed" : "confirmed",
          client_id: clientRec.id,
          location_address: "Home Studio",
          base_price: student.fee,
          total_price: student.fee,
          currency: "GBP",
        });
        events.push(e);
        lessonCount++;

        // Create invoice for past lessons (every month)
        if (currentDate <= new Date() && lessonCount % 4 === 0) {
          const inv = await appClient.entities.Document.create({
            document_type: "invoice",
            document_number: `INV-${String(invoices.length + 1000).slice(-4)}`,
            title: `Monthly Lessons – ${student.name}`,
            client_id: clientRec.id,
            work_event_id: e.id,
            status: currentDate.getTime() < new Date().getTime() - 30*86400000 ? "paid" : "sent",
            currency: "GBP",
            subtotal: student.fee * 4,
            total: student.fee * 4,
            discount_amount: 0,
            tax_amount: 0,
            due_date: format(addDays(currentDate, 14), "yyyy-MM-dd"),
            paid_date: currentDate < new Date() ? format(addDays(currentDate, 7), "yyyy-MM-dd") : null,
            line_items: [
              { description: "4x Lessons", quantity: 4, unit_price: student.fee, total: student.fee * 4 }
            ],
          });
          invoices.push(inv);

          // Record payment if paid
          if (inv.status === "paid") {
            const p = await appClient.entities.Payment.create({
              document_id: inv.id,
              amount: student.fee * 4,
              payment_date: inv.paid_date,
              payment_method: "bank_transfer",
            });
            payments.push(p);
          }
        }

        // Advance by 7 days for weekly, 14 for bi-weekly
        const daysToAdd = student.frequency === "weekly" ? 7 : 14;
        currentDate = addDays(currentDate, daysToAdd);
      }
    }

    // === GIGS (mix of types) ===
    const gigTypes = [
      { type: "Wedding", basePrice: 1200, count: 8 },
      { type: "Corporate", basePrice: 800, count: 15 },
      { type: "Venue – Jazz Quartet", basePrice: 400, count: 30 },
      { type: "Venue – Solo Performance", basePrice: 250, count: 25 },
      { type: "Private Party", basePrice: 600, count: 12 },
      { type: "Session/Recording", basePrice: 500, count: 8 },
      { type: "Festival", basePrice: 350, count: 6 },
    ];

    let gigIndex = 0;
    for (const gigType of gigTypes) {
      for (let i = 0; i < gigType.count; i++) {
        let currentDate = new Date(startDate);
        currentDate = addDays(currentDate, Math.floor(Math.random() * 850)); // Random within range
        if (currentDate > endDate) continue;

        const fee = gigType.basePrice + Math.floor(Math.random() * 400 - 200); // ±£200 variation

        // Pick a client
        let clientId = "";
        if (gigType.type.includes("Wedding")) {
          const agency = clients.find(c => c.client_type === "agent");
          clientId = agency?.id || "";
        } else if (gigType.type.includes("Corporate")) {
          const corp = clients.filter(c => c.client_type === "corporate");
          clientId = corp[Math.floor(Math.random() * corp.length)]?.id || "";
        } else if (gigType.type.includes("Venue")) {
          const venue = clients.filter(c => c.client_type === "venue");
          clientId = venue[Math.floor(Math.random() * venue.length)]?.id || "";
        }

        const e = await appClient.entities.WorkEvent.create({
          title: `${gigType.type} ${gigIndex}`,
          event_type: "Gig",
          date: format(currentDate, "yyyy-MM-dd"),
          start_time: "19:30",
          end_time: "23:30",
          status: currentDate <= new Date() ? "completed" : "confirmed",
          client_id: clientId,
          location_address: "London, UK",
          base_price: fee,
          total_price: fee,
          currency: "GBP",
          notes: `${gigType.type} performance`,
        });
        events.push(e);

        // Create estimate/invoice
        const estNum = String(invoices.length + 1000).slice(-4);
        const inv = await appClient.entities.Document.create({
          document_type: "invoice",
          document_number: `INV-${estNum}`,
          title: `${gigType.type} Performance`,
          client_id: clientId,
          work_event_id: e.id,
          status: currentDate <= new Date() ? "paid" : "sent",
          currency: "GBP",
          subtotal: fee,
          total: fee,
          discount_amount: 0,
          tax_amount: 0,
          due_date: format(addDays(currentDate, 7), "yyyy-MM-dd"),
          paid_date: currentDate <= new Date() ? format(addDays(currentDate, 3), "yyyy-MM-dd") : null,
          line_items: [{ description: gigType.type, quantity: 1, unit_price: fee, total: fee }],
        });
        invoices.push(inv);

        // Record payment if paid
        if (inv.status === "paid") {
          const p = await appClient.entities.Payment.create({
            document_id: inv.id,
            amount: fee,
            payment_date: inv.paid_date,
            payment_method: "bank_transfer",
          });
          payments.push(p);
        }

        gigIndex++;
      }
    }

    // === PRACTICE GOALS & SESSIONS ===
    const goals = [
      { title: "Master improvisation over chord changes", description: "Focus on ii-V-I progressions" },
      { title: "Improve reading speed", description: "Jazz standards and contemporary pieces" },
      { title: "Develop tone control", description: "Work on dynamics and expression" },
      { title: "Expand repertoire", description: "Learn 10 new standards" },
      { title: "Strengthen fingerpicking technique", description: "Classical and jazz styles" },
    ];

    const goalRecs = [];
    for (const g of goals) {
      const goal = await appClient.entities.PracticeGoal.create({
        title: g.title,
        description: g.description,
        completed: false,
      });
      goalRecs.push(goal);
    }

    // Create practice sessions (2-3 per week)
    let practiceDate = new Date(startDate);
    while (practiceDate <= endDate) {
      // Create practice session
      const randomGoal = Math.random() > 0.5 ? goalRecs[Math.floor(Math.random() * goalRecs.length)] : null;
      const session = await appClient.entities.PracticeSession.create({
        date: format(practiceDate, "yyyy-MM-dd"),
        duration_minutes: 60 + Math.floor(Math.random() * 60), // 60-120 mins
        notes: "Regular practice session",
        goal_id: randomGoal?.id || null,
        energy_rating: 2 + Math.floor(Math.random() * 4), // 2-5
      });

      practiceDate = addDays(practiceDate, 3); // Every 3 days roughly
    }

    // === EQUIPMENT ===
    const equipmentItems = [
      { name: "Fender Stratocaster", category: "Guitar", condition: "excellent" },
      { name: "Gibson Les Paul", category: "Guitar", condition: "excellent" },
      { name: "Yamaha Classical", category: "Guitar", condition: "good" },
      { name: "Marshall Amplifier", category: "Amplifier", condition: "excellent" },
      { name: "Shure SM58 Microphone", category: "Microphone", condition: "excellent" },
      { name: "Behringer Mixer", category: "Mixer", condition: "good" },
      { name: "Music Stand", category: "Accessory", condition: "good" },
      { name: "Guitar Case", category: "Case", condition: "excellent" },
      { name: "Cable Set", category: "Cable", condition: "good" },
      { name: "Tuner Pedal", category: "Pedal", condition: "excellent" },
    ];

    for (const item of equipmentItems) {
      await appClient.entities.Equipment.create({
        name: item.name,
        category: item.category,
        condition: item.condition,
      });
    }

    return {
      clientsCreated: clients.length,
      eventsCreated: events.length,
      invoicesCreated: invoices.length,
      paymentsCreated: payments.length,
      goalsCreated: goalRecs.length,
    };
  } catch (err) {
    console.error("Error generating busy musician data:", err);
    throw err;
  }
}
