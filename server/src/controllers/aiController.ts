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

export const aiReply = async (req: Request, res: Response) => {
  const { text, userId = "demo-user" } = req.body || {};

  try {
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, [
        { role: "system", content: "You are Porter Saathi, a concise task-focused assistant for deliveries." },
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
  //  Now include address in reply
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
   
//UPDATE ADDRESS

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
