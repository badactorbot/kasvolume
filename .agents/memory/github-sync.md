---
name: GitHub synchronization
description: Repository updates when the workspace Git remote cannot authenticate but GitHub is connected.
---

The workspace's HTTPS Git remote can reject a direct push even when the Replit GitHub connection has permission to write to the repository. Use the existing GitHub connection's authenticated API instead of requesting a token or assuming the repository is inaccessible.

**Why:** A direct push failed authentication while a verified GitHub connection successfully updated the repository. The local Replit checkpoint history and GitHub branch history were different, so a blind force-push would have been unsafe.

**How to apply:** Compare the remote branch and tree with the local tracked files, exclude incidental screenshots and metadata unless requested, build an API commit on the current remote head, and update the branch without force. Verify the resulting branch head and changed paths.