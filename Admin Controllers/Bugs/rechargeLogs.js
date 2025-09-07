const Recharge_logs = require('../../models/recharge_logs/Recharge_Logs.Model');

exports.createRechargeLogs = async ({ data }) => {
    try {
        const comming_data = data || {};

        const newRechargeLog = await Recharge_logs.create(comming_data);

        return newRechargeLog;

    } catch (error) {
        console.error("Error creating recharge log:", error);
        throw error;
    }
};
