# simple mitm proxy

Simple mitm proxy for sniffing reqs when testing
Saves every request/response pair to its own file in the logs folder

## Usage

# Set up your endpoint in .env

```env
TARGET_URL=https://whatever.com
PROXY_PORT=3000
```

# Run it

```bash
npm start
```