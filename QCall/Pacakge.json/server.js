const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Supabase Client using Environment Variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables!");
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("DB ready");

// API Route to Get Clients
app.get('/api/clients', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*');

        if (error) throw error;
        res.status(200).json({ success: true, clients: data });
    } catch (err) {
        console.error("Error fetching clients:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Route to Add Client with Generated UUID
const crypto = require('crypto'); // Ensure crypto is imported

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
            console.error("Supabase error:", error);
            return res.status(400).json({ success: false, error: error.message || error.details });
        }

        res.status(200).json({ success: true, id: clientId, data });
    } catch (err) {
        console.error("Server exception:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
// API Route to Delete Client
app.delete('/api/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('clients')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("Error deleting client:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 QCall Server running on port ${PORT}`);
});