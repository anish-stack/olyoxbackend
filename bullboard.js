// config/bullBoard.js
const { ExpressAdapter } = require('@bull-board/express');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');


const { queue: notificationQueue } = require('./queues/sendNotificationQuee');
const { queue: notificationQueueUser } = require('./queues/sendUserNotifications');
const locationQueue = require('./queues/LocationQue');
const { AddRideInModelOfDb, DriverSearchQueue } = require('./queues/IntercityRideAddQue');
const setupBullBoard = (app) => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullAdapter(notificationQueue),
      new BullAdapter(locationQueue),
      new BullAdapter(DriverSearchQueue),
      new BullAdapter(notificationQueueUser),
      new BullAdapter(AddRideInModelOfDb)


    ],
    serverAdapter,
  });



  app.use('/admin/queues', serverAdapter.getRouter());
  
  console.log('🔧 Bull Board dashboard available at: /admin/queues');
  
  return serverAdapter;
};

module.exports = setupBullBoard;