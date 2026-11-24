# Start Local MySQL 8 Server Daemon for DocumentUnderstanding
$basedir = "C:\Program Files\MySQL\MySQL Server 8.4"
$myini = "D:\mysql_data\my.ini"

if (Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue) {
    Write-Host "MySQL 8 is already running and listening on port 3306."
    exit 0
}

Write-Host "Starting MySQL Server 8.4 on port 3306..."
& "$basedir\bin\mysqld.exe" --defaults-file="$myini"
