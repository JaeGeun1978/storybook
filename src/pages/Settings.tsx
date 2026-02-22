import React from 'react';
import { useSettings } from '../contexts/SettingsContext';

const Settings: React.FC = () => {
    const {
        apiKey, setApiKey,
        ttsEngine, setTtsEngine,
        systemInstruction, setSystemInstruction
    } = useSettings();

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h1>Settings</h1>

            {/* API Key Section */}
            <section style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
                <h3>API Key</h3>
                <p style={{ fontSize: '14px', color: '#666' }}>
                    Enter your Google Gemini or Cloud API Key. This key is stored locally in your browser.
                </p>
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter API Key"
                    style={{ width: '100%', padding: '10px', marginTop: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
            </section>

            {/* TTS Engine Selection */}
            <section style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
                <h3>TTS Engine</h3>
                <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="ttsEngine"
                            value="gemini"
                            checked={ttsEngine === 'gemini'}
                            onChange={() => setTtsEngine('gemini')}
                            style={{ marginRight: '8px' }}
                        />
                        <span style={{ fontWeight: 'bold' }}>Gemini Live Voice</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="ttsEngine"
                            value="cloud"
                            checked={ttsEngine === 'cloud'}
                            onChange={() => setTtsEngine('cloud')}
                            style={{ marginRight: '8px' }}
                        />
                        <span>Google Cloud TTS</span>
                    </label>
                </div>
            </section>

            {/* System Instruction (Only for Gemini) */}
            {ttsEngine === 'gemini' && (
                <section style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f0f8ff' }}>
                    <h3>Gemini System Instruction</h3>
                    <p style={{ fontSize: '14px', color: '#666' }}>
                        Define the persona and tone for the storyteller.
                    </p>
                    <textarea
                        value={systemInstruction}
                        onChange={(e) => setSystemInstruction(e.target.value)}
                        rows={5}
                        style={{ width: '100%', padding: '10px', marginTop: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                </section>
            )}
        </div>
    );
};

export default Settings;
