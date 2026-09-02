const crypto = require('crypto'); // Add this near the top of server.js if it's not already there

// ... existing setup / middleware ...

app.post('/api/clients', async (req, res) => {
    try {
        // 1. Generate a unique ID for the client
        const clientId = crypto.randomUUID(); 

        const { name, phone, instance, token } = req.body;

        // 2. Insert into your Supabase database table
        const { data, error } = await supabase
            .from('clients')
            .insert([{ 
                id: clientId, 
                name: name, 
                phone: phone, 
                instance: instance, 
                token: token 
            }]);

        if (error) {
            throw error;
        }

        res.status(200).json({ success: true, id: clientId, data });
    } catch (err) {
        console.error("Error adding client:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});