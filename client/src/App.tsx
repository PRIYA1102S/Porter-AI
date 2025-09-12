import React from 'react';
import VoiceInterface from './components/VoiceInterface';

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(120deg, #f8fafc 0%, #e0e7ff 100%)',
      fontFamily: 'Inter, Arial, sans-serif',
    }}>
      <header style={{
        marginBottom: 32,
        textAlign: 'center',
      }}>
        <img src="https://cdn-icons-png.flaticon.com/512/3062/3062634.png" alt="PorterAI Logo" style={{ width: 64, marginBottom: 12 }} />
        <h1 style={{ fontWeight: 600, fontSize: 32, color: '#3730a3', margin: 0 }}>Porter Saathi</h1>
        <p style={{ color: '#6366f1', fontSize: 18, margin: 0 }}>AI Voice Partner for Empowerment</p>
      </header>
      <main style={{ width: '100%', maxWidth: 520 }}>
        <VoiceInterface />
      </main>
      <footer style={{ marginTop: 40, color: '#a5b4fc', fontSize: 14 }}>
        &copy; {new Date().getFullYear()} Porter Saathi. All rights reserved.
      </footer>
    </div>
  );
}

export default App;