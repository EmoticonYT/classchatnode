#!/bin/bash
cd /home/host/classchatnode
pm2 start server.js --name classchat
sleep 10
zrok share reserved classchat --headless
echo "PM2 Successfully started."
