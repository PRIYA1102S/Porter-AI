// server/src/controllers/aiController.ts
import { Request, Response } from "express";
import Groq from "groq-sdk";
import Order from "../models/Order";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
const MODEL = "llama-3.1-8b-instant";

// Minimal message type for internal history
type Msg = {
  role: "system" | "user" | "assistant" | "function";
  content: string;
  // name only used for function messages (optional)
  name?: string;
};

// In-memory conversation history per user (demo)
const conversationHistory = new Map<string, Msg[]>();

function makeTrackingId() {
  return "ORD-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function parseIntent(text: string): { intent: string; trackingId?: string } {
  const t = text.toLowerCase();
  if (/create (an )?order|place order|i want to order|new order|add order/.test(t)) return { intent: "create_order" };
  const track = t.match(/track (?:order )?([A-Za-z0-9\-]+)/i) || t.match(/where is order ([A-Za-z0-9\-]+)/i);
  if (track) return { intent: "track_order", trackingId: track[1] };
  if (/next pickup|next delivery|next order|what's my next pickup|what is my next pickup/.test(t)) return { intent: "next_pickup" };
  if (/list (my )?orders|show (my )?orders|recent orders/.test(t)) return { intent: "list_orders" };
  if (/cancel order|delete order/.test(t)) return { intent: "cancel_order" };
  if (/add address|update address/.test(t))
    return { intent: "update_address" };
  return { intent: "general" };
}

// Use LLM to extract structured order fields from text
async function extractOrderFieldsWithLLM(text: string) {
  if (!groq) return { item: text, qty: 1, address: null, customerName: null, pickupTime: null };

  const system = "You are an extractor. Parse the user message and return JSON only with keys: customerName, address, item, qty (integer), pickupTime (ISO or null). If unknown, use null.";
  const userPrompt = `Extract order details from this user message: """${text}"""`;

  try {
    // Build messages array and cast to any to avoid TS union issue
    const messages = [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ] as unknown as any[];

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0,
    });
    const content = completion.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr);
    return {
      customerName: parsed.customerName || null,
      address: parsed.address || null,
      item: parsed.item || text,
      qty: parsed.qty ? Number(parsed.qty) : 1,
      pickupTime: parsed.pickupTime ? new Date(parsed.pickupTime) : null,
    };
  } catch (err) {
    console.error("Extractor LLM error:", err);
    return { item: text, qty: 1, address: null, customerName: null, pickupTime: null };
  }
}

// Helper for Hindi/vernacular translation (stub)
async function translateToHindi(text: string): Promise<string> {
  // In production, use a translation API or LLM prompt for Hindi/vernacular
  // --- Use Groq LLM for translation if available ---
  if (groq) {
    try {
      const system = "You are a professional translator. Translate the following text to simple, spoken Hindi. Only output the Hindi translation, no extra explanation.";
      const userPrompt = `Translate to Hindi: """${text}"""`;
      const messages = [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ] as any[];
      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.2,
      });
      const translation = completion.choices[0]?.message?.content?.trim();
      if (translation && translation.length > 0) return translation;
    } catch (err) {
      console.error("Hindi translation LLM error:", err);
    }
  }
  // fallback: return original text
  return text;
}

// Helper: Fetch business metrics from real orders in DB
async function getBusinessMetrics(userId: string) {
  // Fetch today's orders for this user
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  // Earnings: sum of all 'delivered' orders' (qty * item price if available, else count as 1)
  // For demo, assume each order is worth 200, expenses 50 per order
  const Order = (await import('../models/Order')).default;
  const todayOrders = await Order.find({
    metadata: { $exists: true, $ne: null },
    createdAt: { $gte: today, $lt: tomorrow },
    // Optionally: createdBy: userId
  });
  const todayEarnings = todayOrders.length * 200;
  const todayExpenses = todayOrders.length * 50;

  // Last week/this week
  const now = new Date();
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setDate(now.getDate() - now.getDay());
  startOfThisWeek.setHours(0, 0, 0, 0);
  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
  const endOfLastWeek = new Date(startOfThisWeek);

  const thisWeekOrders = await Order.find({
    createdAt: { $gte: startOfThisWeek, $lt: now },
    // Optionally: createdBy: userId
  });
  const lastWeekOrders = await Order.find({
    createdAt: { $gte: startOfLastWeek, $lt: endOfLastWeek },
    // Optionally: createdBy: userId
  });
  const thisWeekEarnings = thisWeekOrders.length * 200;
  const lastWeekEarnings = lastWeekOrders.length * 200;

  // Penalties/rewards: for demo, use status or metadata
  const penalties = todayOrders.filter((o: any) => o.status === 'late').map((o: any) => ({ reason: 'Late delivery', amount: 50, date: o.createdAt }));
  const rewards = todayOrders.filter((o: any) => o.status === 'delivered').map((o: any) => ({ reason: 'On-time delivery', amount: 100, date: o.createdAt }));

  return {
    todayEarnings,
    todayExpenses,
    lastWeekEarnings,
    thisWeekEarnings,
    penalties,
    rewards,
  };
}

// Learning modules and guides (mock)
const learningModules = [
  { id: 'insurance', title: 'Vehicle Insurance Basics', summary: 'Learn about vehicle insurance in simple terms.', audioUrl: '', steps: ['Insurance protects you from big expenses.', 'You must renew it every year.', 'Keep your policy document safe.'] },
  { id: 'customer-service', title: 'Customer Service Tips', summary: 'How to keep customers happy.', audioUrl: '', steps: ['Greet customers politely.', 'Be on time.', 'Handle goods carefully.'] },
];
const guides = [
  { id: 'challan', title: 'How to Contest a Challan', steps: ['Go to the official traffic website.', 'Enter your challan number.', 'Upload required documents.', 'Submit your appeal.'] },
  { id: 'digilocker', title: 'How to Upload to DigiLocker', steps: ['Open DigiLocker app.', 'Login with your mobile number.', 'Go to Upload Documents.', 'Select and upload your file.'] },
];

// Add: Helper for concise, context-aware, and empathetic replies
function makeEmpatheticReply(intent: string, context: any = {}) {
  switch (intent) {
    case "road_ahead":
      return "Aage sadak thodi kharab hai, kripya dhyaan se chalayein. Agar aapko koi dikkat ho, Sahayata button dabayein.";
    case "earnings":
      return `Aaj aapne ₹${context.todayEarnings || 0} kamaya aur ₹${context.todayExpenses || 0} kharch kiya. Net earning: ₹${(context.todayEarnings || 0) - (context.todayExpenses || 0)}.`;
    case "penalty":
      return context.penalties && context.penalties.length ? `Aap par penalty lagi hai: ${context.penalties.map((p: any) => `${p.reason} (₹${p.amount})`).join(', ')}.` : 'Aap par koi penalty nahi lagi.';
    case "business_growth":
      return context.thisWeekEarnings > context.lastWeekEarnings ? 'Haan, iss hafte aapka business pichle hafte se behtar hai.' : 'Nahi, iss hafte kamai kam hai.';
    case "onboarding":
      return 'Onboarding mein madad chahiye? Har field ko dhyan se suno. Galti ho toh main aapko bataunga.';
    case "emergency":
      return 'Aapne Sahayata button dabaya hai. Kripya shaant rahiye, madad ke liye call kiya ja raha hai.';
    case "guide_challan":
      return 'Challan contest karne ke liye: 1. Traffic website par jao. 2. Challan number daalo. 3. Document upload karo. 4. Appeal submit karo.';
    case "guide_digilocker":
      return 'DigiLocker mein document upload karne ke liye: 1. App kholo. 2. Login karo. 3. Upload Documents par jao. 4. File select karke upload karo.';
    case "insurance":
      return 'Vehicle insurance aapko bade kharche se bachata hai. Har saal renew karna zaroori hai.';
    case "customer_service":
      return 'Customer se hamesha vinamrata se baat karein, samay par delivery karein, aur samaan dhyaan se sambhalein.';
    default:
      return 'Maaf kijiye, main aapki madad ke liye yahan hoon. Kripya apna sawaal dobara poochhein.';
  }
}

export const aiReply = async (req: Request, res: Response) => {
  const { text, userId = "demo-user" } = req.body || {};

  try {
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, [
        { role: "system", content: "You are Porter Saathi, a concise, empathetic, Hindi-speaking assistant for deliveries. Always explain things simply and offer to speak in Hindi if needed." },
      ]);
    }
    const history = conversationHistory.get(userId)!;
    history.push({ role: "user", content: text });

    const parsed = parseIntent(text);

    // CREATE ORDER
    if (parsed.intent === "create_order") {
      const extracted = await extractOrderFieldsWithLLM(text);
      const trackingId = makeTrackingId();
      const order = new Order({
        customerName: extracted.customerName || undefined,
        address: extracted.address || undefined,
        item: extracted.item,
        qty: extracted.qty || 1,
        status: "created",
        pickupTime: extracted.pickupTime || null,
        trackingId,
        metadata: { createdBy: userId, createdVia: "voice" },
      });
      await order.save();
      const reply = `Order created. Tracking ID ${order.trackingId}.`;
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "created_order", order });
    }

    // TRACK ORDER
    if (parsed.intent === "track_order" && parsed.trackingId) {
      const order = await Order.findOne({ trackingId: parsed.trackingId });
      if (!order) {
        const reply = `I couldn't find order ${parsed.trackingId}.`;
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "order_not_found", trackingId: parsed.trackingId });
      }
      const reply = `Here are the details for ${order.trackingId}: 
        - Customer: ${order.customerName || "N/A"} 
        - Items: ${order.item || "N/A"} 
        - Address: ${order.address || "N/A"} 
        - Status: ${order.status}`;
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "track_order", order });
    }

    // NEXT PICKUP
    if (parsed.intent === "next_pickup") {
      const next = await Order.findOne({ status: { $in: ["created", "assigned", "pending"] } }).sort({ pickupTime: 1, createdAt: 1 });
      if (!next) {
        const reply = "You have no upcoming pickups.";
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "no_pickups" });
      }
      const reply = `Next pickup: ${next.item} (${next.qty}) — ${next.address || "address not set"}. Tracking ID ${next.trackingId}.`;
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "next_pickup", order: next });
    }

    // LIST ORDERS
    if (parsed.intent === "list_orders") {
      const orders = await Order.find({}).sort({ createdAt: -1 }).limit(10);
      const reply = orders.length ? `Showing your ${orders.length} most recent orders.` : "No orders found.";
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "list_orders", orders });
    }

    // CANCEL ORDER
    if (parsed.intent === "cancel_order") {
      const m = text.match(/cancel order ([A-Za-z0-9\-]+)/i);
      if (m && m[1]) {
        const order = await Order.findOneAndUpdate({ trackingId: m[1] }, { status: "cancelled" }, { new: true });
        const reply = order ? `Order ${order.trackingId} cancelled.` : `Couldn't find order ${m[1]}.`;
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "cancel_order", order: order || null });
      } else {
        const reply = "Please provide the order ID to cancel (e.g., 'Cancel order ORD-abc123').";
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "ask_for_order_id" });
      }
    }

    // UPDATE ADDRESS
    if (parsed.intent === "update_address") {
      const m = text.match(/ORD-[A-Za-z0-9]+/i);
      if (!m) {
        const reply = "Please provide the order ID to update the address (e.g., 'Update address of order ORD-abc123 Pune').";
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "ask_for_order_id" });
      }

      const trackingId = m[0].toUpperCase(); // normalize

      // Extract new address
      let addressMatch = text.split(trackingId)[1]?.trim();
      if (addressMatch?.toLowerCase().startsWith("to ")) {
        addressMatch = addressMatch.slice(3).trim();
      }
      if (addressMatch?.toLowerCase().startsWith("is ")) {
        addressMatch = addressMatch.slice(3).trim();
      }
      if (addressMatch?.startsWith(":")) {
        addressMatch = addressMatch.slice(1).trim();
      }

      if (!addressMatch) {
        const reply = `Please provide the new address after the order ID (e.g., 'Update address of order ${trackingId} Pune, Maharashtra').`;
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "ask_for_address", trackingId });
      }

      // Update DB
      const order = await Order.findOneAndUpdate(
        { trackingId },
        { $set: { address: addressMatch } },
        { new: true }
      );

      if (!order) {
        const reply = `Sorry, I couldn't find order ${trackingId}.`;
        history.push({ role: "assistant", content: reply });
        return res.json({ reply, action: "order_not_found", trackingId });
      }

      const reply = ` The address for order ${trackingId} has been updated to: ${order.address}`;
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "update_address", order });
    }

    // --- Intents with concise, empathetic replies ---
    if (/road|sadak|route|weather|unsafe|alert/i.test(text)) {
      const reply = makeEmpatheticReply("road_ahead");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "road_ahead" });
    }
    if (/earn(ings)?|kamaya|kitna kamaya|kharcha|expenses|profit/i.test(text)) {
      const metrics = await getBusinessMetrics(userId);
      const reply = makeEmpatheticReply("earnings", metrics);
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "business_metrics" });
    }
    if (/penalt(y|ies)/i.test(text)) {
      const metrics = await getBusinessMetrics(userId);
      const reply = makeEmpatheticReply("penalty", metrics);
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "penalty" });
    }
    if (/behtar|better than last week|growth|compare|summary|performance/i.test(text)) {
      const metrics = await getBusinessMetrics(userId);
      const reply = makeEmpatheticReply("business_growth", metrics);
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "business_growth" });
    }
    if (/onboard|onboarding|form|document|submit|upload|kyc|pan|aadhaar/i.test(text)) {
      const reply = makeEmpatheticReply("onboarding");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "onboarding_help" });
    }
    if (/emergency|help|sahayata|danger/i.test(text)) {
      const reply = makeEmpatheticReply("emergency");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "emergency" });
    }
    if (/challan/i.test(text)) {
      const reply = makeEmpatheticReply("guide_challan");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "guide_challan" });
    }
    if (/digilocker/i.test(text)) {
      const reply = makeEmpatheticReply("guide_digilocker");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "guide_digilocker" });
    }
    if (/insurance/i.test(text)) {
      const reply = makeEmpatheticReply("insurance");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "insurance" });
    }
    if (/customer service|customer/i.test(text)) {
      const reply = makeEmpatheticReply("customer_service");
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "customer_service" });
    }

    // Conversational Finance
    if (/earn(ings)?|kamaya|kitna kamaya|kharcha|expenses|profit|penalt(y|ies)|reward|business|behtar|better than last week/i.test(text)) {
      const metrics = await getBusinessMetrics(userId);
      let reply = '';
      if (/kharcha|expenses/i.test(text)) {
        reply = `Aaj aapne ₹${metrics.todayEarnings} kamaya aur ₹${metrics.todayExpenses} kharch kiya. Net earning: ₹${metrics.todayEarnings - metrics.todayExpenses}.`;
      } else if (/penalt(y|ies)/i.test(text)) {
        reply = metrics.penalties.length ? `Aap par penalty lagi hai: ${metrics.penalties.map(p => `${p.reason} (₹${p.amount})`).join(', ')}.` : 'Aap par koi penalty nahi lagi.';
      } else if (/reward/i.test(text)) {
        reply = metrics.rewards.length ? `Aapko reward mila hai: ${metrics.rewards.map(r => `${r.reason} (₹${r.amount})`).join(', ')}.` : 'Aapko abhi tak koi reward nahi mila.';
      } else if (/behtar|better than last week/i.test(text)) {
        reply = metrics.thisWeekEarnings > metrics.lastWeekEarnings ? 'Haan, iss hafte aapka business pichle hafte se behtar hai.' : 'Nahi, iss hafte kamai kam hai.';
      } else {
        reply = `Aaj ki kamai: ₹${metrics.todayEarnings}. Pichle hafte: ₹${metrics.lastWeekEarnings}. Iss hafte: ₹${metrics.thisWeekEarnings}.`;
      }
      reply = await translateToHindi(reply);
      history.push({ role: "assistant", content: reply });
      return res.json({ reply, action: "business_metrics" });
    }

    // Voice-Led Onboarding & Forms (mock)
    if (/onboard|onboarding|form|document|submit|upload|kyc|pan|aadhaar/i.test(text)) {
      const reply = 'Onboarding mein madad chahiye? Har field ko dhyan se suno. Example: "Naam daaliye". Agar galti ho, main aapko bataunga. Document upload karne ke liye, photo khinch kar yahan bhejiye.';
      history.push({ role: "assistant", content: await translateToHindi(reply) });
      return res.json({ reply: await translateToHindi(reply), action: "onboarding_help" });
    }

    // Business Growth Simplified
    if (/business|growth|behtar|compare|summary|performance/i.test(text)) {
      const metrics = await getBusinessMetrics(userId);
      const reply = `Aapka business summary: Iss hafte kamai ₹${metrics.thisWeekEarnings}, pichle hafte ₹${metrics.lastWeekEarnings}. ${metrics.thisWeekEarnings > metrics.lastWeekEarnings ? 'Aapne behtar kiya!' : 'Aapko aur mehnat ki zarurat hai.'}`;
      history.push({ role: "assistant", content: await translateToHindi(reply) });
      return res.json({ reply: await translateToHindi(reply), action: "business_summary" });
    }

    // Life Skills: Guides & Learning Modules
    if (/guide|kaise|how to|tutorial|sikhaye|learn|module|insurance|challan|digilocker|customer service/i.test(text)) {
      // Find matching guide/module
      const foundGuide = guides.find(g => text.toLowerCase().includes(g.id) || text.toLowerCase().includes(g.title.toLowerCase()));
      const foundModule = learningModules.find(m => text.toLowerCase().includes(m.id) || text.toLowerCase().includes(m.title.toLowerCase()));
      if (foundGuide) {
        const reply = `${foundGuide.title}:\n${foundGuide.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
        history.push({ role: "assistant", content: await translateToHindi(reply) });
        return res.json({ reply: await translateToHindi(reply), action: "guide", guide: foundGuide });
      }
      if (foundModule) {
        const reply = `${foundModule.title}:\n${foundModule.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
        history.push({ role: "assistant", content: await translateToHindi(reply) });
        return res.json({ reply: await translateToHindi(reply), action: "learning_module", module: foundModule });
      }
      // Fallback
      const reply = 'Kis topic par guide chahiye? Example: "How to contest a challan" ya "Insurance sikhaye".';
      history.push({ role: "assistant", content: await translateToHindi(reply) });
      return res.json({ reply: await translateToHindi(reply), action: "ask_for_guide" });
    }

    // Emergency Assistance & Safety Alerts
    if (/emergency|help|sahayata|suraksha|danger|alert|unsafe|road|weather/i.test(text)) {
      let reply = '';
      if (/emergency|help|sahayata/i.test(text)) {
        reply = 'Aapne Sahayata button dabaya hai. Kripya shaant rahiye, madad ke liye call kiya ja raha hai.';
      } else if (/road|weather|unsafe|alert/i.test(text)) {
        reply = 'Aage sadak kharab hai, kripya dhyaan se chalayein.';
      } else {
        reply = 'Suraksha ke liye, hamesha seatbelt pehnein aur traffic niyam maanein.';
      }
      history.push({ role: "assistant", content: await translateToHindi(reply) });
      return res.json({ reply: await translateToHindi(reply), action: "safety_alert" });
    }

    // FALLBACK -> LLM chat reply
    if (groq) {
      // trim history to last N messages to limit token usage
      const MAX = 8;
      const trimmed = history.slice(-MAX);

      // Build messages array for Groq; include name for function messages if present
      const groqMessages = trimmed.map((m) => {
        if (m.role === "function") {
          return { role: "function", name: m.name || "fn", content: m.content };
        }
        return { role: m.role, content: m.content };
      }) as unknown as any[]; // cast to any[] to satisfy SDK types

      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: groqMessages,
        temperature: 0.2,
      });

      const aiReply = completion.choices[0]?.message?.content || "Sorry, I didn't get that.";
      history.push({ role: "assistant", content: aiReply });
      return res.json({ reply: aiReply, action: "llm_reply" });
    }

    // If no LLM, fallback to rule-based minimal reply
    const fallbackReply = "Sorry, I couldn't process that right now.";
    history.push({ role: "assistant", content: fallbackReply });
    return res.json({ reply: fallbackReply, action: "fallback" });
  } catch (err) {
    console.error("aiReply error:", err);
    return res.status(500).json({ reply: "Internal error", error: err });
  }
};
