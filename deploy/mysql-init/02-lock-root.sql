-- Lock root so it cannot be used to log in after initialization
ALTER USER 'root'@'localhost' ACCOUNT LOCK;
ALTER USER 'root'@'%' ACCOUNT LOCK;
