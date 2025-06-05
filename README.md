# MCP Money

![MCP Money](https://ei.marketwatch.com/Multimedia/2018/02/13/Photos/ZG/MW-GD647_skynet_20180213113524_ZG.jpg?uuid=e41f2218-10db-11e8-b127-9c8e992d421e)

An MCP (Model Context Protocol) money implementation for Nostr using NDK (Nostr Development Kit) with Cashu ecash functionality.

## Features

- **Cashu Wallet Integration**: Full support for Cashu ecash mints and tokens
- **Lightning Network**: Deposit via Lightning invoices and pay Lightning invoices
- **Nostr Zaps**: Send zaps to users using npub or NIP-05 identifiers
- **Multi-mint Support**: Manage multiple Cashu mints simultaneously
- **Persistent Storage**: Wallet state saved to local file with mint info caching
- **MCP Server**: Expose wallet functionality through Model Context Protocol
- **CLI Interface**: Direct command-line usage for all wallet operations

## Installation

```bash
npm install mcp-money
```

## Usage

### MCP Server Mode (Default)

Run without arguments to start the MCP server:

```bash
npx mcp-money
```

### CLI Mode

Use specific commands for direct wallet operations:

```bash
# Get total balance
npx mcp-money get_balance

# Get balance per mint
npx mcp-money get_mint_balances

# Create deposit invoice
npx mcp-money deposit 1000 https://testnut.cashu.space

# Pay lightning invoice
npx mcp-money pay lnbc1...

# Send a zap
npx mcp-money zap npub1... 100 "Great post!"

# Add a new mint
npx mcp-money add_mint https://mint.example.com
```

### Authentication

The wallet supports multiple ways to provide your Nostr private key:

1. **Command line**: `--nsec nsec1...`
2. **Environment variable**: `NSEC=nsec1...`
3. **Config file**: Automatically saved to `.wallet.json`
4. **Auto-generate**: Creates new key if none provided

## MCP Tools

When running as an MCP server, the following tools are available:

- `get_balance`: Get the total wallet balance
- `get_mint_balances`: Get balance breakdown per mint
- `deposit`: Create a deposit invoice for specified amount and mint
- `pay`: Pay a Lightning invoice
- `zap`: Send a zap to a user
- `add_mint`: Add a mint to the wallet

## Configuration

The wallet automatically creates a `.wallet.json` file to store:

- Private key (nsec)
- Public key (npub)
- Configured relays
- Configured mints
- Cached mint information

### Default Relays

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.nostr.band`
- `wss://nostr.mutinywallet.com`

### Default Mints

- `https://mint.coinos.io`
- `https://mint.lnvoltz.com`
- `https://mint.chorus.community`

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Start wallet
npm start
```

## Architecture

Built on top of:

- **NDK**: Nostr Development Kit for Nostr protocol interactions
- **NDK Wallet**: Cashu wallet implementation
- **Nostr Tools**: Low-level Nostr utilities
- **Bun**: Fast JavaScript runtime and package manager

## Security

- Private keys are stored locally in `.wallet.json`
- Mint information is cached for performance
- All Nostr communications use standard NIP protocols
- Lightning payments require explicit confirmation

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please open an issue on the GitHub repository.
