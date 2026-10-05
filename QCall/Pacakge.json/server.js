const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON bodies
app.use(express.json());
// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Route for Admin Dashboard page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API: Get all clients
app.get('/api/clients', async (req, res) => {
    try {
        const { data, error } = await supabase.from('clients').select('*');
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("Error fetching clients:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Add a new client
app.post('/api/clients', async (req, res) => {
    try {
        const { name, phone, instance, token, plan, expires } = req.body;

        const { data, error } = await supabase
            .from('clients')
            .insert([{ name, phone, instance, token, plan, expires }]);

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("Error adding client:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Delete a client
app.delete('/api/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('clients').delete().eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting client:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 QCall Server running on port ${PORT}`);
});