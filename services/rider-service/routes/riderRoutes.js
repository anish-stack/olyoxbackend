const { registerRider, getAllRiders } = require("../controllers/rider.controller");
const express = require("express");

const router = express.Router();

router.post("/register", registerRider);
router.get("/get-all",getAllRiders)

module.exports = router;
