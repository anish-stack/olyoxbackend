const Login_bugs_reports = require("../../models/Admin/Login_bugs_reports");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const streamUpload = (buffer, filename) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "bug_screenshots", public_id: filename },
            (error, result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(error);
                }
            }
        );
        const readable = new Readable();
        readable._read = () => {}; // noop
        readable.push(buffer);
        readable.push(null);
        readable.pipe(stream);
    });
};

exports.createReport = async (req, res) => {
    try {
        const { name, message, number } = req.body;
        const file = req.file;

        if (!message || !number) {
            return res.status(400).json({ success: false, message: "Message and number are required." });
        }

        let screenshot = null;

        if (file && file.buffer) {
            // Upload to Cloudinary using buffer
            const result = await streamUpload(file.buffer, file.originalname.split(".")[0]);
            screenshot = result.secure_url;

          
        }

        const report = new Login_bugs_reports({
            name,
            message,
            number,
            screenshot
        });

        await report.save();

        res.status(201).json({ success: true, message: "Bug report submitted successfully.", data: report });
    } catch (error) {
        console.error("Create Report Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
};

// Get all reports
exports.getAllReports = async (req, res) => {
    try {
        const reports = await Login_bugs_reports.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: reports });
    } catch (error) {
        console.error("Get All Reports Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
};

// Get single report by ID
exports.getSingleReport = async (req, res) => {
    try {
        const { id } = req.params;
        const report = await Login_bugs_reports.findById(id);
        if (!report) {
            return res.status(404).json({ success: false, message: "Report not found." });
        }
        res.status(200).json({ success: true, data: report });
    } catch (error) {
        console.error("Get Single Report Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
};

// Update report (admin handle status + bugFix)
exports.updateReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, bugFix } = req.body;

        const report = await Login_bugs_reports.findById(id);
        if (!report) {
            return res.status(404).json({ success: false, message: "Report not found." });
        }

        report.adminHandle.status = status || report.adminHandle.status;
        report.adminHandle.bugFix = bugFix || report.adminHandle.bugFix;
        report.adminHandle.handledAt = new Date();

        await report.save();
        res.status(200).json({ success: true, message: "Report updated successfully.", data: report });
    } catch (error) {
        console.error("Update Report Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
};

// Delete report
exports.deleteReport = async (req, res) => {
    try {
        const { id } = req.params;
        const report = await Login_bugs_reports.findByIdAndDelete(id);
        if (!report) {
            return res.status(404).json({ success: false, message: "Report not found." });
        }
        res.status(200).json({ success: true, message: "Report deleted successfully." });
    } catch (error) {
        console.error("Delete Report Error:", error);
        res.status(500).json({ success: false, message: "Something went wrong." });
    }
};
