const CancelReason = require("../../models/Admin/cancelReasonSchema");

// In-memory cache
const cancelReasonCache = new Map();
const CACHE_KEY = 'allCancelReasons';

// Create a new cancel reason
exports.createCancelReason = async (req, res) => {
    try {
        const { name, description, status } = req.body;
        if (!name) {
            return res.status(400).json({ message: "Name is required" });
        }

        const newCancelReason = new CancelReason({ name, description, status });
        await newCancelReason.save();

        // Invalidate cache
        cancelReasonCache.delete(CACHE_KEY);

        res.status(201).json({ message: "Cancel reason created successfully", data: newCancelReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Update a cancel reason
exports.updateCancelReason = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, status } = req.body;

        const updatedReason = await CancelReason.findByIdAndUpdate(
            id,
            { name, description, status },
            { new: true, runValidators: true }
        );

        if (!updatedReason) {
            return res.status(404).json({ message: "Cancel reason not found" });
        }

        // Invalidate cache
        cancelReasonCache.delete(CACHE_KEY);

        res.status(200).json({ message: "Cancel reason updated successfully", data: updatedReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get all cancel reasons
exports.getAllCancelReasons = async (req, res) => {
    try {
        if (cancelReasonCache.has(CACHE_KEY)) {
            return res.status(200).json({ message: "Cancel reasons fetched successfully", data: cancelReasonCache.get(CACHE_KEY) });
        }

        const query = req.query.active || 'active';
        const type = req.query.type || 'driver';
        const cancelReasons = await CancelReason.find({ status: query, cancelReasonType: type }).lean();

        // Store in cache
        cancelReasonCache.set(CACHE_KEY, cancelReasons);

        res.status(200).json({ message: "Cancel reasons fetched successfully", data: cancelReasons });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get all cancel reasons (admin)
exports.getAllCancelReasonsAdmin = async (req, res) => {
    try {
        if (cancelReasonCache.has(CACHE_KEY)) {
            return res.status(200).json({ success: true, message: "Cancel reasons fetched successfully", data: cancelReasonCache.get(CACHE_KEY) });
        }

        const allReason = await CancelReason.find({}).lean();
        if (!allReason) {
            return res.status(400).json({ message: "No cancel reason found" });
        }

        // Store in cache
        cancelReasonCache.set(CACHE_KEY, allReason);

        res.status(200).json({ success: true, message: "Cancel reasons fetched successfully", data: allReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get a single cancel reason by ID
exports.getSingleCancelReason = async (req, res) => {
    try {
        const { id } = req.params;
        const cancelReason = await CancelReason.findById(id);
        if (!cancelReason) {
            return res.status(404).json({ message: "Cancel reason not found" });
        }
        res.status(200).json({ message: "Cancel reason fetched successfully", data: cancelReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Delete a cancel reason
exports.deleteCancelReason = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedReason = await CancelReason.findByIdAndDelete(id);
        if (!deletedReason) {
            return res.status(404).json({ message: "Cancel reason not found" });
        }

        // Invalidate cache
        cancelReasonCache.delete(CACHE_KEY);

        res.status(200).json({ message: "Cancel reason deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Toggle cancel reason status
exports.toggleCancelReason = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const cancelReason = await CancelReason.findById(id);
        if (!cancelReason) {
            return res.status(404).json({ message: "Cancel reason not found" });
        }

        cancelReason.status = status;
        await cancelReason.save();

        // Invalidate cache
        cancelReasonCache.delete(CACHE_KEY);

        res.status(200).json({ message: "Cancel reason status updated", data: cancelReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
