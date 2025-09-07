const PrivacyPolicy = require("../../models/Policy/Policy.model");

// Create a new policy
exports.createPolicy = async (req, res) => {
    try {
        const { title, description, content, category } = req.body;

        // Validation
        if (!title || !description || !content || !category) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const newPolicy = new PrivacyPolicy({ title, description, content, category });
        const savedPolicy = await newPolicy.save();

        res.status(201).json({ message: 'Policy created successfully', policy: savedPolicy });
    } catch (error) {
        console.error('Error creating policy:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Update policy by ID
exports.updatePolicy = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, content, category } = req.body;

        // Validation
        if (!title || !description || !content || !category) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const updatedPolicy = await PrivacyPolicy.findByIdAndUpdate(
            id,
            {
                title,
                description,
                content,
                category,
                updatedAt: new Date(),
            },
            { new: true }
        );

        if (!updatedPolicy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        res.status(200).json({ message: 'Policy updated successfully', policy: updatedPolicy });
    } catch (error) {
        console.error('Error updating policy:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get policy details by ID
exports.getPolicyById = async (req, res) => {
    try {
        const { id } = req.params;
        const policy = await PrivacyPolicy.findById(id);

        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        res.status(200).json(policy);
    } catch (error) {
        console.error('Error fetching policy by ID:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.getPolicies = async (req, res) => {
    try {
   
        const policy = await PrivacyPolicy.find();

        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        res.status(200).json(policy);
    } catch (error) {
        console.error('Error fetching policy by ID:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
// Find policy by title
exports.findPolicyByTitle = async (req, res) => {
    try {
        const { title } = req.query;

        if (!title) {
            return res.status(400).json({ error: 'Title query parameter is required' });
        }

        const policies = await PrivacyPolicy.find({ title: { $regex: new RegExp(title, 'i') } });

        if (policies.length === 0) {
            return res.status(404).json({ error: 'No policies found with this title' });
        }

        res.status(200).json(policies);
    } catch (error) {
        console.error('Error finding policy by title:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};


// Delete policy by ID
exports.deletePolicy = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedPolicy = await PrivacyPolicy.findByIdAndDelete(id);

        if (!deletedPolicy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        res.status(200).json({ message: 'Policy deleted successfully', policy: deletedPolicy });
    } catch (error) {
        console.error('Error deleting policy:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
