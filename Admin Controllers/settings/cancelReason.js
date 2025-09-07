const CancelReason = require("../../models/Admin/cancelReasonSchema");

// Create a new cancel reason
exports.createCancelReason = async (req, res) => {
    try {
        const { name, description, status } = req.body;

        if (!name) {
            return res.status(400).json({ message: "Name is required" });
        }

        const newCancelReason = new CancelReason({ name, description, status });
        await newCancelReason.save();

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

        res.status(200).json({ message: "Cancel reason updated successfully", data: updatedReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get all cancel reasons
exports.getAllCancelReasons = async (req, res) => {
    try {
        const query = req.query.active || 'active'
        const type = req.query.type || 'driver'
        const cancelReasons = await CancelReason.find({ status: query, cancelReasonType: type });
        res.status(200).json({ message: "Cancel reasons fetched successfully", data: cancelReasons });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

exports.getAllCancelReasonsAdmin = async (req, res) => {
    try {
        const allReason = await CancelReason.find({});
        if (!allReason) {
            return res.status(400).json({ message: "No cancel reason found" });
        }
        res.status(200).json({ success: true, message: "Cancel reasons fetched successfully", data: allReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

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

        res.status(200).json({ message: "Cancel reason deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Toggle cancel reason status (active/inactive)
exports.toggleCancelReason = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        console.log('data', id)
        const cancelReason = await CancelReason.findById(id);

        if (!cancelReason) {
            return res.status(404).json({ message: "Cancel reason not found" });
        }

        // cancelReason.status = cancelReason.status === "active" ? "inactive" : "active";
        cancelReason.status = status;
        await cancelReason.save();

        res.status(200).json({ message: "Cancel reason status updated", data: cancelReason });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
