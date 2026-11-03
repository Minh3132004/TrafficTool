@echo off
chcp 65001 > nul
echo =======================================================
echo     MAYACA M4 - CHẠY TRAFFIC GA4 (CHUẨN BÀI TẬP)
echo =======================================================
echo.
echo Chỉ tiêu:
echo  - New Users: 50
echo  - Returning Users: 10
echo  - Active Users: 25 (> 10s, cuộn trang, tương tác)
echo.
node traffic-bot.js
pause
