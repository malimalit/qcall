const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// 1. Validate environment variables early
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables!");
}

// 2. Initialize Supabase client once
const supabase = createClient(supabaseUrl, supabaseKey);
console.log("DB ready");

// --- ULTRA-MSG FUNCTION USING NATIVE FETCH ---
async function sendUltraMsgMessage(phone, message) {
    const instanceId = process.env.ULTRAMSG_INSTANCE_ID || process.env.ULTRAMSG_INSTANCE || 'instance188449';
    const token = process.env.ULTRAMSG_TOKEN || '6ocaa7cx7sq050ht';

    const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
    
    const bodyParams = new URLSearchParams({
        token: token,
        to: phone,
        body: message || 'Hello from QCall!'
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: bodyParams
        });

        const result = await response.json();
        console.log("UltraMsg response:", result);
        return { success: true, data: result };
    } catch (error) {
        console.error("Error sending UltraMsg message:", error.message);
        return { success: false, error: error.message };
    }
}

// 3. API Route to Get Clients
app.get('/api/clients', async (req, res) => {
    try {
        const { data, error } = await supabase.from('clients').select('*');
        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (err) {
        console.error("Error fetching clients:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. API Route to Add Client with Generated UUID
app.post('/api/clients', async (req, res) => {
    try {
        const clientId = crypto.randomUUID(); 
        const { name, phone, instance, token, plan, expires } = req.body;

        console.log("Generated clientId:", clientId);

        const { data, error } = await supabase
            .from('clients')
            .insert([{ 
                id: clientId, 
                name: name, 
                phone: phone, 
                instance: instance, 
                token: token,
                plan: plan || 'Active',
                expires: expires || null
            }])
            .select();

        if (error) {
            console.error("Supabase full error object:", JSON.stringify(error));
            return res.status(400).json({ 
                success: false, 
                error: typeof error === 'object' ? JSON.stringify(error) : String(error)
            });
        }

        // Optional: Send a welcome/test message via UltraMsg if phone exists
        if (phone) {
            await sendUltraMsgMessage(phone, `Hello ${name || 'Client'}, welcome to QCall! Your account is active.`);
        }

        res.status(200).json({ success: true, id: clientId, data });
    } catch (err) {
        console.error("Server exception:", err);
        res.status(500).json({ success: false, error: err.message || String(err) });
    }
});

// 5. API Route to Delete Client
app.delete('/api/clients/:id', async (req, res) => {
    try {
        const clientId = req.params.id;
        const { error } = await supabase
            .from('clients')
            .delete()
            .eq('id', clientId);

        if (error) throw error;
        res.status(200).json({ success: true, message: "Client deleted" });
    } catch (err) {
        console.error("Error deleting client:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 7. Single unified server listener
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 QCall Server running on port ${PORT}`);
});