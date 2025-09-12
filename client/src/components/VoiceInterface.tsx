import React, { useState, useRef, useEffect } from "react";
import { trackOrder, updateOrder, deleteOrder } from "../services/orderService";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

interface ChatMessage {
  role: "user" | "ai";
  content: string;
}

interface Reminder {
  time: string;
  text: string;
}

// helper function to detect trackingId
function extractTrackingId(text: string) {
  const match = text.match(/ORD-[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

const VoiceInterface: React.FC = () => {
  const [listening, setListening] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const speak = (text: string) => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel(); // Always cancel any ongoing speech first
      // Add a small delay to avoid race conditions
      setTimeout(() => {
        const utter = new window.SpeechSynthesisUtterance(text);
        utter.rate = 1;
        utter.pitch = 1;
        utter.volume = 1;
        utter.lang = 'en-IN'; // Use Indian English for better Hindi/vernacular support
        window.speechSynthesis.speak(utter);
      }, 100);
    }
  };

  const sendToAI = async (text: string) => {
    if (!text) return;
    setChatHistory((prev) => [...prev, { role: "user", content: text }]);
    setTextInput("");

    // Check for reminder
    const reminderMatch = text.match(
      /(?:remind(?: me)?|reminder|schedule|pickup).*?(\d{1,2}(?::\d{2})?\s?(?:am|pm))/i
    );
    if (reminderMatch) {
      const time = reminderMatch[1];
      setReminders((prev) => [...prev, { time, text }]);
      const reply = `I'll remind you at ${time}.`;
      setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
      speak(reply);
      return;
    }

    // Extract trackingId
    const trackingId = extractTrackingId(text);

    // ---- UPDATE ORDER ----
    if (
      text.toLowerCase().includes("update") ||
      text.toLowerCase().includes("modify") ||
      text.toLowerCase().includes("change")
    ) {
      if (!trackingId) {
        const reply = "Please provide a valid tracking ID to update an order.";
        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
        return;
      }

      try {
        // Get the order
        const order = await trackOrder(trackingId);
        if (!order || !order._id) {
          const reply = `Sorry, I couldn’t find any order with ID ${trackingId}.`;
          setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
          speak(reply);
          return;
        }

        const lowerText = text.toLowerCase();
        const updates: any = {};

        // ---- Status updates ----
        if (lowerText.includes("delivered")) updates.status = "Delivered";
        if (lowerText.includes("processing")) updates.status = "Processing";
        if (lowerText.includes("shipped")) updates.status = "Shipped";

        // ---- Pickup time ----
        if (lowerText.includes("pickup"))
          updates.pickupTime = new Date().toISOString();

        // ---- Assignee ----
        if (lowerText.includes("assign")) {
          // Try to detect assignee name after 'assign'
          const match = text.match(/assign\s+to\s+([a-zA-Z ]+)/i);
          updates.assignedTo = match ? match[1].trim() : "Priya Sharma";
        }

        // ---- Add items ----
        if (lowerText.includes("add")) {
          const addIndex = lowerText.indexOf("add");
          const itemsText = text.substring(addIndex + 3).trim();
          const itemsToAdd = itemsText.split(/\s*(?:,|and)\s*/).filter(Boolean);
          updates.items = [...(order.items || []), ...itemsToAdd];
        }

        // ---- Remove items ----
        if (lowerText.includes("remove")) {
          const removeIndex = lowerText.indexOf("remove");
          const itemsText = text.substring(removeIndex + 6).trim();
          const itemsToRemove = itemsText
            .split(/\s*(?:,|and)\s*/).filter(Boolean);
          updates.items = (order.items || []).filter(
            (item: string) => !itemsToRemove.includes(item)
          );
        }

        if (Object.keys(updates).length === 0) {
          const reply =
            "What would you like to update? (status, items, pickup time, assignee, etc.)";
          setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
          speak(reply);
          return;
        }

        console.log("Updating order:", order._id, updates);

        const updated = await updateOrder(order._id, updates);

        const reply = `Order ${trackingId} updated successfully.
- Status: ${updated.status || "unchanged"}
- Pickup time: ${updated.pickupTime || "not set"}
- Assigned to: ${updated.assignedTo || "not set"}
- Items: ${updated.items?.join(", ") || "no items"}`;

        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
      } catch (err) {
        console.error(err);
        const reply = `Failed to update order ${trackingId}. Please try again.`;
        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
      }
    }

    // ---- DELETE ORDER ----
    if (
      text.toLowerCase().includes("delete") ||
      text.toLowerCase().includes("cancel")
    ) {
      if (!trackingId) {
        const reply = "Please provide a valid tracking ID to delete an order.";
        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
        return;
      }

      try {
        // First fetch order by trackingId
        const order = await trackOrder(trackingId);

        if (!order || !order._id) {
          const reply = `Sorry, I couldn’t find any order with ID ${trackingId}.`;
          setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
          speak(reply);
          return;
        }

        // Delete using MongoDB _id
        const response = await deleteOrder(order._id);

        const reply = response.success
          ? `Order ${trackingId} has been deleted successfully.`
          : `Failed to delete order ${trackingId}.`;

        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
      } catch (err) {
        console.error(err);
        const reply = `Failed to delete order ${trackingId}. Please try again.`;
        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
      }

      return; // prevent falling into TRACK ORDER block
    }

    // ---- TRACK ORDER ----
    if (trackingId) {
      try {
        const order = await trackOrder(trackingId);
        const reply = `Here are the details for ${trackingId}:\n
- Customer: ${order.customerName || "N/A"}\n
- Items: ${order.item || "N/A"}\n
- Address: ${order.address || "N/A"}\n
- Status: ${order.status || "Processing"}`;

        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
        return;
      } catch (err) {
        const reply = `Sorry, I couldn’t find any order with ID ${trackingId}.`;
        setChatHistory((prev) => [...prev, { role: "ai", content: reply }]);
        speak(reply);
        return;
      }
    }

    // Default → send to AI backend
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", content: data.reply },
      ]);
      speak(data.reply);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", content: "Sorry, I couldn't process your request." },
      ]);
      speak("Sorry, I couldn't process your request.");
    }
  };

  const handleListen = () => {
    if (!recognition) return alert("Speech Recognition not supported");
    if (listening) return;
    // Set recognition language to Hindi (hi-IN) for robust Hindi/vernacular support
    recognition.lang = "hi-IN"; // Change to 'en-IN' for English, or add a toggle for both
    setListening(true);
    recognition.start();
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      sendToAI(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
  };

  const handleStop = () => {
    if (recognition && listening) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.stop();
      setListening(false);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendToAI(textInput.trim());
      setTextInput("");
    }
  };

  const quickActions = [
    { label: "💰 Earnings Today", text: "Aaj ka kharcha kaat ke kitna kamaya?" },
    { label: "📈 Business Growth", text: "Mera business pichle hafte se behtar hai ya nahi?" },
    { label: "📝 Onboarding Help", text: "Onboarding mein madad chahiye" },
    { label: "🚨 Emergency", text: "Sahayata" },
    { label: "📚 Insurance Guide", text: "Insurance sikhaye" },
    { label: "🛣️ Road Alert", text: "Aage sadak kharab hai?" },
  ];

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: '#18181b',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      zIndex: 100,
      overflow: 'auto',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 700,
        margin: '0 auto',
        background: 'transparent',
        borderRadius: 0,
        boxShadow: 'none',
        display: 'flex',
        flexDirection: 'column',
        padding: '32px 0 0 0',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 18,
          paddingLeft: 32,
        }}>
          <span style={{ fontSize: 38, background: '#23232a', borderRadius: 12, padding: 6 }}>🤖</span>
          <span style={{ fontWeight: 700, fontSize: 32, color: '#fff', letterSpacing: 1 }}>Porter Saathi</span>
        </div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          paddingLeft: 32,
          marginBottom: 18,
        }}>
          {quickActions.map((action, idx) => (
            <button
              key={idx}
              style={{
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '10px 22px',
                fontWeight: 600,
                fontSize: 17,
                cursor: 'pointer',
                boxShadow: '0 2px 8px #6366f133',
                transition: 'background 0.2s',
              }}
              onClick={() => sendToAI(action.text)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div
          ref={chatContainerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            background: '#18181b',
            padding: '32px 24px 24px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            minHeight: 400,
          }}
        >
          {chatHistory.length === 0 && (
            <div style={{ color: '#a1a1aa', fontSize: 22, textAlign: 'center', marginTop: 80 }}>
              What are you working on?
            </div>
          )}
          {chatHistory.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                width: '100%',
                animation: 'fadeIn 0.5s',
              }}
            >
              <div
                style={{
                  background: msg.role === "user" ? 'linear-gradient(90deg, #6366f1 60%, #818cf8 100%)' : '#23232a',
                  color: msg.role === "user" ? '#fff' : '#e0e7ef',
                  borderRadius: 18,
                  padding: '22px 36px',
                  minWidth: 320,
                  maxWidth: 540,
                  width: 'fit-content',
                  fontSize: 20,
                  fontWeight: 500,
                  boxShadow: '0 4px 24px #6366f133',
                  marginLeft: msg.role === "user" ? 80 : 0,
                  marginRight: msg.role === "user" ? 0 : 80,
                  wordBreak: 'break-word',
                  transition: 'background 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  minHeight: 56,
                  border: msg.role === "user" ? '2px solid #818cf8' : '2px solid #23232a',
                  boxSizing: 'border-box',
                  animation: 'slideIn 0.4s',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>
        <form
          onSubmit={handleTextSubmit}
          style={{
            display: 'flex',
            gap: 10,
            padding: '28px 32px',
            background: '#23232a',
            borderBottomLeftRadius: 24,
            borderBottomRightRadius: 24,
            alignItems: 'center',
            boxShadow: '0 -2px 12px #23232a44',
          }}
        >
          <button
            onClick={handleListen}
            disabled={listening}
            type="button"
            style={{
              background: listening ? '#a5b4fc' : '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0 22px',
              fontWeight: 600,
              fontSize: 26,
              cursor: listening ? 'not-allowed' : 'pointer',
              minWidth: 54,
              minHeight: 54,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px #6366f133',
            }}
          >
            {listening ? <span>🎤</span> : <span>🎙️</span>}
          </button>
          <button
            onClick={handleStop}
            disabled={!listening}
            type="button"
            style={{
              background: !listening ? '#23232a' : '#ef4444',
              color: !listening ? '#a1a1aa' : '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0 22px',
              fontWeight: 600,
              fontSize: 26,
              cursor: !listening ? 'not-allowed' : 'pointer',
              minWidth: 54,
              minHeight: 54,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4,
              boxShadow: '0 2px 8px #ef444433',
            }}
          >
            ⏹️
          </button>
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Ask anything"
            style={{
              flex: 1,
              padding: '22px 28px',
              borderRadius: 14,
              border: '1.5px solid #23232a',
              fontSize: 20,
              outline: 'none',
              background: '#18181b',
              color: '#fff',
              minWidth: 0,
              boxShadow: '0 2px 8px #23232a33',
            }}
          />
          <button
            type="submit"
            style={{
              background: '#3730a3',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0 28px',
              fontWeight: 600,
              fontSize: 26,
              cursor: 'pointer',
              minWidth: 54,
              minHeight: 54,
              boxShadow: '0 2px 8px #3730a333',
            }}
          >
            ➤
          </button>
        </form>
        {/* Animations */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideIn {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
        {reminders.length > 0 && (
          <div style={{
            background: '#18181b',
            padding: '8px 24px',
            borderBottomLeftRadius: 24,
            borderBottomRightRadius: 24,
            borderTop: '1px solid #23232a',
          }}>
            <h4 style={{ color: '#6366f1', marginBottom: 8, fontSize: 16 }}>Reminders:</h4>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {reminders.map((rem, idx) => (
                <li key={idx}>
                  <strong>{rem.time}</strong>: {rem.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceInterface;
