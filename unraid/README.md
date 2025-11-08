# KeepLocal Unraid Templates

This directory contains Unraid Docker container templates for easy installation through the Unraid WebUI.

## Installation Methods

### Method 1: Docker Compose Stack (Recommended)

This is the easiest method - everything is set up automatically.

1. Install the **Docker Compose Manager** plugin from Community Applications
2. In Docker Compose Manager, click **Add New Stack**
3. Name it "KeepLocal"
4. Copy the contents of `keeplocal-compose.xml` OR the root `docker-compose.yml` file
5. Update the `ALLOWED_ORIGINS` environment variable with your Unraid server IP
6. Click **Compose Up**
7. Access KeepLocal at `http://[UNRAID-IP]:3000`

### Method 2: Individual Containers

Install each container separately through the Unraid Docker tab.

#### Step 1: Add Template Repository

1. Go to **Docker** tab in Unraid
2. Click **Add Container** at the bottom
3. Click **Template repositories** (at the top)
4. Add this URL:
   ```
   https://github.com/zwaetschge/KeepLocal/tree/main/unraid
   ```
5. Click **Save**

#### Step 2: Install MongoDB

1. Search for **KeepLocal-MongoDB** in templates
2. Configure the data path (default: `/mnt/user/appdata/keeplocal/mongodb`)
3. Note the MongoDB port (default: 27017)
4. Click **Apply**
5. Wait for container to start

#### Step 3: Install Server

1. Search for **KeepLocal-Server** in templates
2. Update configuration:
   - **MongoDB URI**: `mongodb://[UNRAID-IP]:27017/keeplocal`
   - **Allowed Origins**: `http://[UNRAID-IP]:3000`
3. Click **Apply**
4. Wait for container to start

#### Step 4: Install Client

1. Search for **KeepLocal-Client** in templates
2. Update configuration:
   - **WebUI Port**: 3000 (or your preferred port)
   - **API Server URL**: `http://[UNRAID-IP]:5000`
3. Click **Apply**
4. Access KeepLocal at `http://[UNRAID-IP]:3000`

## Template Files

- `mongodb.xml` - MongoDB database container
- `server.xml` - KeepLocal backend API server
- `client.xml` - KeepLocal frontend web interface
- `keeplocal-compose.xml` - Complete Docker Compose stack

## Building Custom Images

If you want to build the Docker images yourself:

```bash
cd /path/to/KeepLocal
./build-images.sh
```

You can specify custom tags:
```bash
VERSION=1.0.0 DOCKER_REGISTRY=myregistry/ ./build-images.sh
```

Then update the `Repository` fields in the XML templates to use your custom images.

## Configuration

### Important Environment Variables

**Server:**
- `MONGODB_URI` - MongoDB connection string
- `ALLOWED_ORIGINS` - CORS allowed origins (must include client URL)
- `NODE_ENV` - Set to `production` for Unraid
- `SESSION_SECRET` - Optional security key

**Client:**
- `REACT_APP_API_URL` - Backend API URL (server URL with port 5000)

### Network Configuration

All containers use **bridge** networking by default. Make sure to:
1. Use your Unraid server's IP address in all URLs
2. Ensure ports 27017 (MongoDB), 5000 (Server), and 3000 (Client) are not in use
3. Update CORS origins if using a custom client port

## Troubleshooting

### Cannot Access WebUI

1. Check if all three containers are running (MongoDB, Server, Client)
2. Verify port mappings in container settings
3. Check `ALLOWED_ORIGINS` includes your access URL
4. Review container logs for errors

### CORS Errors

If you see CORS errors in browser console:
1. Go to KeepLocal-Server container settings
2. Edit `ALLOWED_ORIGINS` variable
3. Add your actual access URL: `http://[UNRAID-IP]:[PORT]`
4. Restart the server container

### Database Connection Issues

1. Ensure MongoDB container is running first
2. Verify `MONGODB_URI` in server settings uses correct IP and port
3. Check MongoDB container logs: `docker logs KeepLocal-MongoDB`

### Data Persistence

MongoDB data is stored at `/mnt/user/appdata/keeplocal/mongodb` by default.
- Check folder permissions if data isn't persisting
- Backup this folder to preserve your notes

## Updating

### Docker Compose Method
```bash
cd /path/to/stack
docker-compose pull
docker-compose up -d
```

### Individual Containers Method
1. Go to Docker tab
2. Click container name
3. Click **Force Update**
4. Apply changes

## Support

For issues and questions:
- GitHub Issues: https://github.com/zwaetschge/KeepLocal/issues
- Project Repository: https://github.com/zwaetschge/KeepLocal
