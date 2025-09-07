const Heavy_vehicle_partners = require('../../models/Heavy_vehicle/Heavy_vehicle_partners');
const CallAndMessageRequest = require('../../models/Heavy_vehicle/CallAndMessageRequest');
const SendWhatsAppMessage = require('../../utils/whatsapp_send');
const User = require('../../models/normal_user/User.model');
exports.getheaveyPartners = async (req, res) => {
    try {
        const { lat, lng, page = 1, limit = 10 } = req.query;
        const pageInt = parseInt(page);
        const limitInt = parseInt(limit);
        const skip = (pageInt - 1) * limitInt;

        const baseQuery = {
            status: "Active",
            is_blocked: false,
            name: { $ne: null },
            phone_number: { $ne: null },
            isAlldocumentsVerified: true
        };

        let partners = [];
        let totalCount = 0;
        let resultType = "All Partners (No location provided)";

        const getPartnersWithLocation = async (radiusInMeters) => {
            const query = {
                ...baseQuery,
                'service_areas.location': {
                    $geoWithin: {
                        $centerSphere: [
                            [parseFloat(lng), parseFloat(lat)],
                            radiusInMeters / 6378137 // radius in radians (Earth radius in meters)
                        ]
                    }
                }
            };

            const foundPartners = await Heavy_vehicle_partners.find(query)
                .populate('vehicle_info')
                .select('-documents')
                .skip(skip)
                .limit(limitInt);

            const count = await Heavy_vehicle_partners.countDocuments(query);

            return { foundPartners, count };
        };

        if (lat && lng) {
            let locationSearch = await getPartnersWithLocation(5000); // 5 km
            partners = locationSearch.foundPartners;
            totalCount = locationSearch.count;
            resultType = "Nearby Partners (within 5 km)";

            if (partners.length === 0) {
                locationSearch = await getPartnersWithLocation(15000); // 15 km
                partners = locationSearch.foundPartners;
                totalCount = locationSearch.count;
                resultType = "Nearby Partners (within 15 km)";
            }

            if (partners.length === 0) {
                partners = await Heavy_vehicle_partners.find(baseQuery)
                    .populate('vehicle_info')
                    .select('-documents')
                    .skip(skip)
                    .limit(limitInt);

                totalCount = await Heavy_vehicle_partners.countDocuments(baseQuery);
                resultType = "All Partners (No location match)";
            }

        } else {
            partners = await Heavy_vehicle_partners.find(baseQuery)
                .populate('vehicle_info')
                .select('-documents')
                .skip(skip)
                .limit(limitInt);

            totalCount = await Heavy_vehicle_partners.countDocuments(baseQuery);
        }

        return res.status(200).json({
            resultType,
            page: pageInt,
            limit: limitInt,
            totalPages: Math.ceil(totalCount / limitInt),
            totalCount,
            partners
        });

    } catch (error) {
        console.error("Error fetching heavy vehicle partners:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};


exports.CreateCallAndMessageRequest = async (req, res) => {
    try {
        const { senderId, receiverId, requestType, message } = req.body;


        if (!requestType) {
            return res.status(400).json({ message: "Please select a request type (Call or Message)." });
        }

        if (!['call', 'message'].includes(requestType)) {
            return res.status(400).json({ message: "Invalid request type. Only 'call' or 'message' are allowed." });
        }


        const partner = await Heavy_vehicle_partners.findById(receiverId);
        if (!partner) {
            return res.status(404).json({ message: "We couldn’t find the selected partner. Please try again." });
        }

        const user = await User.findById(senderId);


        const newRequest = new CallAndMessageRequest({
            senderId,
            receiverId,
            requestType,
            message
        });

        const savedRequest = await newRequest.save();


        let notificationMessage = '';
        if (requestType === 'call') {
            notificationMessage = `Hello ${partner.name || ''},\nYou have received a new *CALL* request from ${user.name} (${user.number || 'N/A'}).\nPlease reach out to them as soon as possible.`;
        } else if (requestType === 'message') {
            notificationMessage = `Hello ${partner.name || ''},\nYou have received a new *MESSAGE* from ${user.name} (${user.number || 'N/A'}).\nMessage: "${message || 'No message provided.'}"`;
        }

        SendWhatsAppMessage(notificationMessage, partner.phone_number);

        // Respond to user
        return res.status(201).json({
            message: `Your ${requestType === 'call' ? 'call' : 'message'} request has been sent to the partner successfully.`,
            request: savedRequest
        });

    } catch (error) {
        console.error("Error while creating request:", error);
        return res.status(500).json({ message: "Sorry, something went wrong on our end. Please try again later." });
    }
};



exports.getAllCallAndMessage = async (req, res) => {
    try {
        const data = await CallAndMessageRequest.find()
            .populate('receiverId')
            .populate('senderId');


        if (!data) {
            return res.status(404).json({ message: 'No call or message records found' });
        }


        res.status(200).json({
            success: true,
            data: data
        });
    } catch (error) {
        // Catch any errors that occur during the query execution
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};


exports.getCallAndMessageByHevyVehicleId = async (req, res) => {
    try {
        const { id } = req.params;

        const requests = await CallAndMessageRequest.find({ receiverId: id }).populate("senderId").populate("receiverId")
        if (!requests) {
            return res.status(400).json({
                success: false,
                message: "No request found"
            });
        }
        return res.status(200).json({ success: true, message: "All requests fetched successfully", data: requests });
    } catch (error) {
        console.error("Error fetching heavy vehicle partners:", error);
        return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
}

exports.changeCallAndMessageRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const request = await CallAndMessageRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        request.status = status;
        const updatedRequest = await request.save();
        return res.status(200).json({ message: "Request status updated successfully", request: updatedRequest });
    } catch (error) {
        console.error("Error updating request status:", error);
        return res.status(500).json({ message: "Failed to update request status" });
    }
};

exports.deleteCallAndMessageRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const request = await CallAndMessageRequest.findByIdAndDelete(id);
        if (!request) {
            return res.status(404).json({ message: "Request not found" });
        }
        return res.status(200).json({ message: "Request deleted successfully" });
    } catch (error) {
        console.error("Error deleting request:", error);
        return res.status(500).json({ message: "Failed to delete request" });
    }
}

exports.updateStatusRequest = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Oops! Something went wrong. Request ID is missing.',
            });
        }

        const checkRequest = await CallAndMessageRequest.findById(id);
        if (!checkRequest) {
            return res.status(404).json({
                success: false,
                message: 'Sorry, we couldn’t find the request you are trying to update.',
            });
        }

        const { status } = req.body;
        const validStatus = [
            'pending',
            'accepted',
            'rejected',
            'Checked',
            'Bookmark',
            'Not Interested',
            'User By Mistake',
        ];

        if (!validStatus.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Please select a valid status to update.',
            });
        }

        checkRequest.status = status;
        await checkRequest.save();

        return res.status(200).json({
            success: true,
            message: `The request status has been updated to "${status}" successfully.`,
            data: checkRequest,
        });
    } catch (error) {
        console.error('Error updating status:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong while updating the status. Please try again later.',
        });
    }
};

exports.addNote = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Oops! Something went wrong. Request ID is missing.',
            });
        }

        const checkRequest = await CallAndMessageRequest.findById(id);
        if (!checkRequest) {
            return res.status(404).json({
                success: false,
                message: 'Sorry, we couldn’t find the request you are trying to update.',
            });
        }

        const { note } = req.body;
        if (!note || typeof note !== 'string' || note.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Note cannot be empty. Please provide a valid note.',
            });
        }

        // Get current date and time in IST
        const istDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        console.log('istDate',istDate)

        // Push note with IST timestamp
        checkRequest.noteByReciver.push({
            note: note.trim(),
            date: istDate,
        });

        await checkRequest.save();

        return res.status(200).json({
            success: true,
            message: 'Your note has been added successfully with Indian date and time.',
            data: checkRequest.noteByReciver,
        });

    } catch (error) {
        console.error('Error adding note:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong while adding your note. Please try again later.',
        });
    }
};


exports.editNote = async (req, res) => {
    try {
        const { requestId, noteId } = req.params;
        const { updatedNote } = req.body;

        if (!requestId || !noteId || !updatedNote?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Missing request ID, note ID, or updated note text.',
            });
        }

        const request = await CallAndMessageRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Request not found.',
            });
        }

        const note = request.noteByReciver.id(noteId);
        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found.',
            });
        }

        note.note = updatedNote.trim();
        note.date = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        await request.save();

        return res.status(200).json({
            success: true,
            message: 'Note updated successfully.',
            data: request.noteByReciver,
        });
    } catch (error) {
        console.error('Error editing note:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong while editing the note.',
        });
    }
};


exports.deleteNote = async (req, res) => {
    try {
        const { requestId, noteId } = req.params;

        if (!requestId || !noteId) {
            return res.status(400).json({
                success: false,
                message: 'Missing request ID or note ID.',
            });
        }

        const request = await CallAndMessageRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Request not found.',
            });
        }

        const note = request.noteByReciver.id(noteId);
        if (!note) {
            return res.status(404).json({
                success: false,
                message: 'Note not found.',
            });
        }

        await note.deleteOne(); // Mongoose subdocument removal
        await request.save();

        return res.status(200).json({
            success: true,
            message: 'Note deleted successfully.',
            data: request.noteByReciver,
        });
    } catch (error) {
        console.error('Error deleting note:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong while deleting the note.',
        });
    }
};
