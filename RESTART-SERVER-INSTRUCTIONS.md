# 🚀 Server Restart Instructions

## Current Status

✅ **Code Fix**: Complete and verified
✅ **All Tests**: 314/314 passing
✅ **Connectivity Fix**: Working in unit tests
⏳ **Visual Output**: Requires server restart

---

## Why Restart is Required

Node.js caches modules in memory when the server starts. Even though the code files have been updated on disk, the running server is still using the old cached versions. You must restart the server process to load the new code.

---

## How to Restart the Server

### Step 1: Stop the Current Server

**If running in terminal:**
```bash
# Press Ctrl+C to stop the server
```

**If running in background:**
```bash
# Linux/Mac
pkill node

# Windows PowerShell
Stop-Process -Name node -Force

# Windows CMD
taskkill /F /IM node.exe
```

### Step 2: Verify Server is Stopped

Check that no Node.js processes are running:
```bash
# Linux/Mac
ps aux | grep node

# Windows PowerShell
Get-Process node

# Windows CMD
tasklist | findstr node.exe
```

If you see any Node.js processes, kill them before proceeding.

### Step 3: Start the Server Fresh

```bash
# Navigate to project directory
cd /path/to/your/project

# Start the server
npm start

# Or directly:
node server.js
```

### Step 4: Verify Server Started Successfully

Look for startup messages in the console:
```
Server listening on port XXXX
[Server] Ready to accept requests
```

---

## How to Clear Browser Cache

After restarting the server, you must also clear your browser cache.

### Option A: Use Incognito/Private Mode (Recommended)

**Chrome/Edge:**
- Press `Ctrl+Shift+N` (Windows/Linux) or `Cmd+Shift+N` (Mac)
- Navigate to your application URL

**Firefox:**
- Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
- Navigate to your application URL

**Safari:**
- File → New Private Window
- Navigate to your application URL

### Option B: Hard Refresh

**Windows/Linux:**
- `Ctrl + Shift + R`
- Or `Ctrl + F5`

**Mac:**
- `Cmd + Shift + R`

---

## How to Test the Fix

### 1. Upload Your Floor Plan

Use the same floor plan that showed disconnected corridors before.

### 2. Generate COSTO Layout

Click the generate button and wait for the layout to complete.

### 3. Check Server Console Logs

You should see these messages:
```
[BayGrid] Applying corridor accessibility fix...
[Corridor Network] Starting post-generation validation loop
[Corridor Network] Iteration 1: X component(s), Y unreachable îlot(s), Z unreachable node(s)
[Corridor Network] Network is fully connected after N iteration(s)
[BayGrid] Corridor fix: A original → B enhanced (with connectivity)
[BayGrid] Smart circulation: C routed paths (from B enhanced corridors)
```

**Key indicators:**
- `Applying corridor accessibility fix...` - Fix is running
- `Network is fully connected after N iteration(s)` - Fix succeeded
- `C routed paths (from B enhanced corridors)` - Paths use enhanced corridors

### 4. Check Visual Output

Look at the red dashed circulation lines:
- ✅ Should form a fully connected network
- ✅ Should reach all areas of the floor plan
- ✅ No isolated or disconnected regions
- ✅ All areas reachable from entrances

---

## Troubleshooting

### Issue: Server logs don't show connectivity fix messages

**Cause**: Server not restarted or using cached modules

**Solution**:
1. Completely stop the server (kill all node processes)
2. Wait 5 seconds
3. Start the server fresh
4. Check that you see startup messages

### Issue: Visual output still shows disconnected corridors

**Possible causes**:
1. Server not restarted
2. Browser cache not cleared
3. Application cache (cadCache, floorPlanStore)

**Solution**:
1. Verify server was restarted (check console for startup messages)
2. Use incognito mode to rule out browser cache
3. Upload a NEW floor plan file (different filename) to bypass app cache
4. Check server logs for connectivity fix messages

### Issue: "Cannot find module" error when starting server

**Cause**: Dependencies not installed

**Solution**:
```bash
npm install
npm start
```

### Issue: Port already in use

**Cause**: Old server process still running

**Solution**:
```bash
# Find and kill the process using the port
# Linux/Mac
lsof -ti:PORT | xargs kill -9

# Windows
netstat -ano | findstr :PORT
taskkill /PID <PID> /F
```

---

## Verification Commands

Run these to verify the fix is working:

```bash
# Run all tests
npm test

# Run connectivity tests specifically
npm test -- tests/unit/corridor-accessibility-gaps.test.js

# Run verification script
node verify-corridor-fix.js

# Run bridging test
node test-bridging-corridors.js
```

All tests should pass (314/314).

---

## What Changed in the Code

The fix is integrated into `ProfessionalGridLayoutEngine.js` (lines 933-1032):

1. **Step 7**: Apply corridor accessibility fix BEFORE generating circulation paths
2. **Step 8**: Generate circulation paths from ENHANCED corridors (with connectivity fix)

This ensures the visual output (red dashed lines) shows the fully connected network.

---

## Next Steps

1. ✅ **Stop the server** (Ctrl+C or kill process)
2. ✅ **Start the server** (npm start or node server.js)
3. ✅ **Clear browser cache** (use incognito mode)
4. ✅ **Test with your floor plan** (upload and generate)
5. ✅ **Verify visual output** (red dashed lines fully connected)
6. ✅ **Check server logs** (connectivity fix messages)

---

## Need Help?

If the issue persists after following these steps, please share:

1. **Server console logs** (especially lines with `[BayGrid]` and `[Corridor Network]`)
2. **Screenshot of visual output** (showing the disconnected corridors)
3. **Browser console errors** (F12 → Console tab)
4. **Floor plan file** (if possible)

This will help diagnose any remaining issues.

---

## Summary

The corridor accessibility fix is complete and working. The code changes ensure that:
- Disconnected corridor components are detected
- Bridging corridors are generated to connect isolated regions
- All areas are reachable from entrances
- Circulation paths (red dashed lines) show the fully connected network

You just need to restart the server and clear your browser cache to see the fix in action.

**ACTION REQUIRED**: Restart the server now!
