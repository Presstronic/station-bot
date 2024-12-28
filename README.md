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




### Migration
1. Generate migration
   ```
   npm run migration:generate
   ```
2. Run migrations
   ```
   npm run typeorm -- migration:run -d src/data-source.ts
   ```