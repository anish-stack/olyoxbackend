const mongoose = require("mongoose");
const sentLogSchema = new mongoose.Schema({
    date: String, // e.g. "2025-09-23"
    sentIndexes: [Number]
});
const SentLog = mongoose.model("SentLog", sentLogSchema);
module.exports = SentLog;