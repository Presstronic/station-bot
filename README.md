# Discord Verification Bot

A Discord bot for verifying users against their RSI (Roberts Space Industries) profiles.

## Features

- Generates a unique verification code for users.
- Instructs users to add the code to their RSI profile's short bio.
- Provides a "Verify" button for users to initiate the verification process.
- Notifies moderators for manual verification.
- Assigns a "Verified Citizen" role upon successful verification.

## Setup and Installation

### Prerequisites

- Node.js v16.9.0 or higher.
- Discord account with permissions to add bots to a server.

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/discord-verification-bot.git
   cd discord-verification-bot
   ```

## Runtime Safety Mode

The bot now defaults to read-only mode for operational safety.

- Default: `BOT_READ_ONLY_MODE=true`
- Effect: command and button interactions return a maintenance message and perform no mutations.
- Effect: startup side effects (command registration, default role creation, and scheduling of cleanup jobs) are skipped.

To re-enable normal behavior explicitly:

```bash
BOT_READ_ONLY_MODE=false
```

### Re-Enable Checklist (Production)

1. Set `BOT_READ_ONLY_MODE=false` in your deployment environment.
2. Redeploy or restart the bot process/container.
3. Verify slash commands are registered and responding.
4. Verify expected role automation is active (default role creation and verification role updates).
5. Confirm scheduled cleanup jobs are registered and running.
6. Monitor logs for interaction errors, role assignment failures, and scheduler startup messages.
