const mongoose = require('mongoose');

const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGO_DB_URL);
        console.log('Database is Connected Successfully');
    } catch (error) {
        console.error('Failed to Connect to Database', error);
        process.exit(1);
    }
};

module.exports = connectDb;