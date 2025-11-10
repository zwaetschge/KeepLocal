# KeepLocal Installation Guide for Unraid

This guide will walk you through installing KeepLocal on your Unraid server using the all-in-one Docker container.

## Features

KeepLocal is a self-hosted notes application inspired by Google Keep, featuring:

- 📝 **Google Keep-style todo lists** with checkboxes
- 🔗 **Link preview cards** with Open Graph metadata
- 🔐 **User authentication** with JWT (secure multi-user support)
- 🎨 **10 different colors** for your notes
- 📌 **Pin/unpin functionality**
- 🏷️ **Tags/categories** for better organization
- 🔍 **Full-text search** in title and content
- 🌙 **Dark mode** with theme persistence
- ⌨️ **Keyboard shortcuts** (Ctrl+N, Ctrl+F, Ctrl+K)
- 📱 **Responsive design** (works on desktop and mobile)
- 🔒 **Advanced security** (XSS protection, CSRF, CORS, CSP, Rate Limiting)

## Prerequisites

- Unraid 6.9 or later
- Docker enabled on your Unraid server

## Installation Methods

### Method 1: Using Community Applications (Recommended)

**Note:** This method will be available once KeepLocal is added to the Community Applications repository.

1. Install the **Community Applications** plugin (if not already installed)
2. Go to **Apps** tab
3. Search for **KeepLocal**
4. Click **Install**
5. Configure the settings (see Configuration section below)
6. Click **Apply**

### Method 2: Manual Installation via Template URL

1. Go to the **Docker** tab in your Unraid WebUI
2. Click **Add Container** (at the bottom)
3. In the **Template** dropdown, select **Custom Template**
4. Paste this URL in the **Template URL** field:
   ```
   https://raw.githubusercontent.com/zwaetschge/KeepLocal/main/unraid-template.xml
   ```
5. Click **Download Template**
6. Configure the settings (see Configuration section below)
7. Click **Apply**

### Method 3: Manual Docker Command (Advanced)

If you prefer to use the command line or create a custom setup:

1. Open an Unraid terminal (or SSH into your server)
2. Generate a secure JWT secret:
   ```bash
   openssl rand -base64 32
   ```
3. Run the Docker container:
   ```bash
   docker run -d \
     --name=KeepLocal \
     --net=bridge \
     -p 3000:80 \
     -e JWT_SECRET="YOUR_GENERATED_SECRET_HERE" \
     -e ALLOWED_ORIGINS="http://YOUR_UNRAID_IP:3000" \
     -e NODE_ENV="production" \
     -v /mnt/user/appdata/keeplocal/mongodb:/data/db \
     --restart unless-stopped \
     zwaetschge/keeplocal:latest
   ```

   Replace:
   - `YOUR_GENERATED_SECRET_HERE` with the secret from step 2
   - `YOUR_UNRAID_IP` with your Unraid server's IP address

## Configuration

### Required Settings

| Setting | Description | Default | Example |
|---------|-------------|---------|---------|
| **WebUI Port** | Port to access KeepLocal | 3000 | 3000 |
| **MongoDB Data** | Path to store database | `/mnt/user/appdata/keeplocal/mongodb` | `/mnt/user/appdata/keeplocal/mongodb` |

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `JWT_SECRET` | Secret key for JWT token generation | ⚠️ **YES** | `changeme-generate-secure-secret` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | No | `http://localhost:3000` |
| `NODE_ENV` | Node environment (production/development) | No | `production` |

⚠️ **IMPORTANT:** You **MUST** generate a unique `JWT_SECRET` for security! Use this command:
```bash
openssl rand -base64 32
```

### Recommended Configuration

**For typical home use:**

```
Port: 3000
MongoDB Data: /mnt/user/appdata/keeplocal/mongodb
JWT_SECRET: <generated using openssl rand -base64 32>
ALLOWED_ORIGINS: http://192.168.1.100:3000 (replace with your Unraid IP)
NODE_ENV: production
```

## First Run

1. After installation, wait ~30 seconds for all services to start
2. Open your browser and navigate to: `http://YOUR_UNRAID_IP:3000`
3. You should see the KeepLocal login screen
4. Click **Register** to create your first account
5. Start creating notes!

## Accessing KeepLocal

### Local Network Access
- From your local network: `http://YOUR_UNRAID_IP:3000`
- Example: `http://192.168.1.100:3000`

### Remote Access (Optional)

To access KeepLocal from outside your network, you have several options:

1. **Use Unraid's built-in VPN** (WireGuard or OpenVPN)
2. **Use a reverse proxy** (nginx, Caddy, Traefik) with SSL
3. **Use Cloudflare Tunnel** for secure external access

⚠️ **Security Warning:** Do NOT expose KeepLocal directly to the internet without HTTPS!

## Updating

### Via Community Applications
1. Go to **Apps** tab
2. Click **Check for Updates**
3. If an update is available, click **Update**

### Manually
1. Go to **Docker** tab
2. Find **KeepLocal** container
3. Click the container icon
4. Select **Force Update**

## Backup

Your notes are stored in the MongoDB database. To backup:

1. **Manual Backup:**
   ```bash
   # Stop the container first
   docker stop KeepLocal

   # Backup the MongoDB data directory
   cp -r /mnt/user/appdata/keeplocal/mongodb /mnt/user/backups/keeplocal-backup-$(date +%Y%m%d)

   # Start the container
   docker start KeepLocal
   ```

2. **Using Unraid's CA Backup/Restore Appdata:**
   - Install the **CA Backup/Restore Appdata** plugin
   - Add `/mnt/user/appdata/keeplocal` to your backup configuration

## Troubleshooting

### Container won't start
1. Check logs: Click the container icon → **Logs**
2. Verify MongoDB data directory exists and has correct permissions
3. Ensure port 3000 is not in use by another container

### Can't access WebUI
1. Verify the container is running (green play icon)
2. Check that port 3000 is correctly mapped
3. Try accessing from: `http://UNRAID_IP:3000`
4. Check your firewall settings

### "Connection refused" errors
1. Wait 30-60 seconds after starting (services need time to initialize)
2. Check container logs for errors
3. Verify `ALLOWED_ORIGINS` includes your access URL

### Database errors
1. Stop the container
2. Check MongoDB data directory permissions:
   ```bash
   chown -R 999:999 /mnt/user/appdata/keeplocal/mongodb
   ```
3. Start the container

### Password/Login issues
If you forget your password or need to reset:
```bash
# Stop the container
docker stop KeepLocal

# Remove the database (⚠️ THIS DELETES ALL DATA!)
rm -rf /mnt/user/appdata/keeplocal/mongodb/*

# Start the container
docker start KeepLocal

# Register a new account
```

## Uninstallation

1. Go to **Docker** tab
2. Find **KeepLocal** container
3. Click the container icon
4. Select **Remove**
5. Optionally delete the data directory:
   ```bash
   rm -rf /mnt/user/appdata/keeplocal
   ```

## Support

- **GitHub Issues:** https://github.com/zwaetschge/KeepLocal/issues
- **GitHub Project:** https://github.com/zwaetschge/KeepLocal

## Advanced Configuration

### Using a Custom Domain

If you want to access KeepLocal via a custom domain (e.g., `notes.yourdomain.com`):

1. Set up a reverse proxy (nginx, Caddy, or Traefik)
2. Configure SSL certificates (Let's Encrypt recommended)
3. Update `ALLOWED_ORIGINS` to include your domain:
   ```
   ALLOWED_ORIGINS=https://notes.yourdomain.com
   ```

### Resource Limits

To limit resource usage, add these parameters when creating the container:

```bash
--memory=512m \
--cpus=1.0 \
```

Or via Unraid WebUI:
1. Edit the container
2. Enable **Advanced View** (toggle in top right)
3. Set **CPU Pinning** and **Memory Limit**

## Performance Tips

- **SSD/NVMe for Database:** Store `/data/db` on an SSD or cache drive for better performance
- **Regular Cleanup:** Periodically delete old notes you no longer need
- **Backup Strategy:** Set up automated backups to prevent data loss

## Security Best Practices

1. ✅ **Always use a strong JWT_SECRET** (generated with `openssl rand -base64 32`)
2. ✅ **Use HTTPS** if accessing remotely (via reverse proxy)
3. ✅ **Keep the container updated** to get security patches
4. ✅ **Use strong passwords** for your accounts
5. ✅ **Backup regularly** to prevent data loss
6. ✅ **Don't expose directly to internet** without proper security measures

## What's Inside the Container?

The all-in-one container includes:
- **MongoDB 7.0** - Database for storing notes
- **Node.js 18** - Backend API server
- **Nginx** - Web server for the React frontend
- **Supervisor** - Process manager to run all services

All services are automatically started and monitored by supervisor.

## License

KeepLocal is open-source software. See the [LICENSE](LICENSE) file for details.

---

**Enjoy your self-hosted notes with KeepLocal! 🎉**
