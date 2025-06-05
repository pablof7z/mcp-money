#!/usr/bin/env node

import NDK, { NDKKind, NDKCashuMintList } from '@nostr-dev-kit/ndk';
import { NDKCashuWallet, NDKWalletBalance, NDKCashuDeposit } from '@nostr-dev-kit/ndk-wallet';
import { NDKZapper, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const WALLET_FILE = '.wallet.json';

interface WalletData {
  nsec: string;
  npub: string;
  balance: number;
  relays: string[];
  mints: string[];
  mintInfoCache: Record<string, CachedMintInfo>;
}

interface CachedMintInfo {
  info: MintInfo;
  timestamp: number;
}

interface MintInfo {
  name?: string;
  pubkey?: string;
  version?: string;
  description?: string;
  description_long?: string;
  contact?: Array<{ method: string; info: string }>;
  motd?: string;
  nuts?: Record<string, any>;
}

class MCPWallet {
  private ndk: NDK | null = null;
  private wallet: NDKCashuWallet | null = null;
  private walletData: WalletData | null = null;
  private mintInfoCache = new Map<string, CachedMintInfo>();

  async initialize(nsecOverride?: string): Promise<void> {
    await this.loadOrCreateWallet(nsecOverride);
    await this.setupNDK();
    await this.setupWallet();
  }

  private async loadOrCreateWallet(nsecOverride?: string): Promise<void> {
    try {
      // Load existing wallet from config file
      let walletFromFile: WalletData | null = null;
      if (existsSync(WALLET_FILE)) {
        walletFromFile = JSON.parse(readFileSync(WALLET_FILE, 'utf8'));
      }
      
      // Apply priority order for nsec: 1) CLI arg, 2) env var, 3) config file
      const resolvedNsec = this.resolveNsec(nsecOverride, walletFromFile?.nsec);
      
      if (walletFromFile && resolvedNsec === walletFromFile.nsec) {
        // Use existing wallet if nsec matches
        this.walletData = walletFromFile;
      } else {
        // Create new wallet or update existing with new nsec
        this.walletData = this.createNewWallet(resolvedNsec);
        if (walletFromFile) {
          // Preserve other wallet data (mints, etc.) when updating nsec
          this.walletData.relays = walletFromFile.relays;
          this.walletData.mints = walletFromFile.mints;
          this.walletData.mintInfoCache = walletFromFile.mintInfoCache;
        }
        this.saveWallet();
      }
    } catch (error) {
      console.error('Error loading wallet:', error);
      this.walletData = this.createNewWallet(nsecOverride);
      this.saveWallet();
    }
  }

  private resolveNsec(cliNsec?: string, configNsec?: string): string {
    // Priority: 1) CLI arg, 2) env var, 3) config file, 4) generate new
    return cliNsec || process.env.NSEC || configNsec || nip19.nsecEncode(generateSecretKey());
  }

  private createNewWallet(nsecOverride?: string): WalletData {
    const nsec = this.resolveNsec(nsecOverride);
    const sk = nip19.decode(nsec).data as Uint8Array;
    const npub = nip19.npubEncode(getPublicKey(sk));
    
    return {
      nsec,
      npub,
      balance: 0,
      relays: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://nostr.mutinywallet.com'
      ],
      mints: [
        'https://mint.coinos.io',
        'https://mint.lnvoltz.com',
        'https://mint.chorus.community'
      ],
      mintInfoCache: {}
    };
  }

  private saveWallet(): void {
    if (!this.walletData) return;
    
    this.walletData.mintInfoCache = Object.fromEntries(this.mintInfoCache);
    writeFileSync(WALLET_FILE, JSON.stringify(this.walletData, null, 2));
  }

  private async setupNDK(): Promise<void> {
    if (!this.walletData) throw new Error('Wallet data not loaded');
    
    const signer = new NDKPrivateKeySigner(this.walletData.nsec);
    
    this.ndk = new NDK({
      explicitRelayUrls: this.walletData.relays,
      signer
    });

    await this.ndk.connect(2500);
  }

  private async setupWallet(): Promise<void> {
    if (!this.ndk || !this.walletData) throw new Error('NDK or wallet data not initialized');
    
    this.mintInfoCache = new Map(Object.entries(this.walletData.mintInfoCache || {}));
    
    // First, try to find an existing wallet on Nostr
    this.wallet = (await this.findExistingWallet()) || null;
    
    if (!this.wallet) {
      
      // Create new wallet
      this.wallet = new NDKCashuWallet(this.ndk);
      
      // Configure with default mints
      this.wallet.mints = this.walletData.mints || [];
      
      // Generate P2PK address for receiving nutzaps (required for NIP-60)
      await this.wallet.getP2pk();
      
      // Publish wallet info event to Nostr
      try {
        await this.wallet.publish();
        
        // Also publish mint list for nutzap reception
        await this.publishMintList();
      } catch (error) {
        console.log('⚠️ Could not publish wallet info:', error);
      }
    } else {
    }
    
    // Start wallet monitoring to initialize balance tracking
    await this.wallet.start();
    
    // Set the wallet on the NDK instance for zapping functionality
    this.ndk.wallet = this.wallet;
  }

  private async findExistingWallet(): Promise<NDKCashuWallet | undefined> {
    if (!this.ndk) throw new Error('NDK not initialized');
    
    const activeUser = this.ndk.activeUser;
    if (!activeUser) {
      return undefined;
    }
    
    try {
      const event = await this.ndk.fetchEvent({
        kinds: [NDKKind.CashuWallet],
        authors: [activeUser.pubkey]
      });
      
      if (event) {
        return await NDKCashuWallet.from(event);
      }
    } catch (error) {
      console.log('Error fetching existing wallet:', error);
    }
    
    return undefined;
  }

  private async publishMintList(): Promise<void> {
    if (!this.ndk || !this.wallet) return;
    
    try {
      const mintList = new NDKCashuMintList(this.ndk);
      mintList.mints = this.wallet.mints || [];
      mintList.p2pk = this.wallet.p2pk;
      
      await mintList.publish();
    } catch (error) {
      console.log('⚠️ Could not publish mint list:', error);
    }
  }

  private async handleMintInfoNeeded(mintUrl: string): Promise<MintInfo> {
    if (this.mintInfoCache.has(mintUrl)) {
      const cached = this.mintInfoCache.get(mintUrl)!;
      const cacheAge = Date.now() - cached.timestamp;
      
      // Cache for 1 hour
      if (cacheAge < 3600000) {
        return cached.info;
      }
    }

    try {
      const response = await fetch(`${mintUrl}/v1/info`);
      const mintInfo: MintInfo = await response.json();
      
      // Cache the mint info
      this.mintInfoCache.set(mintUrl, {
        info: mintInfo,
        timestamp: Date.now()
      });
      
      this.saveWallet();
      return mintInfo;
    } catch (error) {
      console.error(`Failed to fetch mint info for ${mintUrl}:`, error);
      throw error;
    }
  }

  async getBalance(): Promise<number> {
    if (!this.wallet) throw new Error('Wallet not initialized');

    try {
      const balance = this.wallet.balance?.amount || 0;
      return balance;
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }

  async getMintBalances(): Promise<Map<string, number>> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    
    try {
      const balances = this.wallet.mintBalances;
      let total = 0;
      const balanceMap = new Map<string, number>();
      
      for (const [mintUrl, balance] of Object.entries(balances)) {
        balanceMap.set(mintUrl, balance);
        total += balance;
      }
      return balanceMap;
    } catch (error) {
      console.error('Error getting mint balances:', error);
      return new Map();
    }
  }

  async createDepositInvoice(amount: number, mintUrl?: string): Promise<{ bolt11: string; amount: number; mintUrl: string; depositId: string }> {
    if (!this.wallet || !this.walletData) throw new Error('Wallet not initialized');
    
    try {
      // If no mint URL provided, use first available mint
      if (!mintUrl) {
        if (!this.walletData.mints || this.walletData.mints.length === 0) {
          throw new Error('No mints configured. Please add a mint first.');
        }
        mintUrl = this.walletData.mints[0];
      }
      
      // Add mint to wallet configuration if not already present
      if (!this.walletData.mints.includes(mintUrl)) {
        this.walletData.mints.push(mintUrl);
        this.wallet.mints = this.walletData.mints;
        this.saveWallet();
      }
      
      const deposit: NDKCashuDeposit = this.wallet.deposit(amount, mintUrl);
      const invoice = await deposit.start();
      
      // Generate unique ID for tracking this deposit
      const depositId = `deposit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set up background monitoring for this deposit
      deposit.on("success", () => {
        console.log(`✅ Deposit ${depositId} completed successfully`);
        this.saveWallet();
      });
      
      deposit.on("error", (error) => {
        console.error(`❌ Deposit ${depositId} failed:`, error);
      });
      
      return { bolt11: invoice, amount, mintUrl, depositId };
      
    } catch (error) {
      console.error('Error creating deposit invoice:', error);
      throw error;
    }
  }

  async deposit(amount: number, mintUrl?: string): Promise<{ success?: boolean; timeout?: boolean; amount: number; mintUrl: string; invoice?: string }> {
    if (!this.wallet || !this.walletData) throw new Error('Wallet not initialized');
    
    try {
      // If no mint URL provided, try all mints concurrently and return first response
      if (!mintUrl) {
        if (!this.walletData.mints || this.walletData.mints.length === 0) {
          throw new Error('No mints configured. Please add a mint first.');
        }
        
        // Create a promise that resolves on first successful mint response
        const firstSuccessfulMint = await new Promise<{mint: string, deposit: NDKCashuDeposit, invoice: string}>((resolve, reject) => {
          let completedAttempts = 0;
          let hasResolved = false;
          
          this.walletData!.mints.forEach(async (mint) => {
            try {
              // Add mint to wallet configuration if not already present
              if (!this.wallet!.mints.includes(mint)) {
                this.wallet!.mints = [...(this.wallet!.mints || []), mint];
              }
              
              const deposit: NDKCashuDeposit = this.wallet!.deposit(amount, mint);
              const invoice = await deposit.start();
              
              // Resolve immediately on first success
              if (!hasResolved) {
                hasResolved = true;
                resolve({ mint, deposit, invoice });
              }
            } catch (error) {
              console.log(`⚠️ Mint ${mint} failed: ${error}`);
              completedAttempts++;
              
              // If all mints failed, reject
              if (completedAttempts === this.walletData!.mints.length && !hasResolved) {
                reject(new Error('All mints failed to create invoice'));
              }
            }
          });
        });
        
        const { mint, deposit, invoice } = firstSuccessfulMint;
        mintUrl = mint;
        
        console.log(invoice);
        
        // Wait for the deposit to complete
        return new Promise((resolve, reject) => {
          deposit.on("success", () => {
            this.saveWallet();
            resolve({ success: true, amount, mintUrl: mintUrl! });
          });
          
          deposit.on("error", (error) => {
            console.error(`❌ Deposit failed:`, error);
            reject(error);
          });
          
          // Optional: Add a timeout after 10 minutes
          setTimeout(() => {
            resolve({ timeout: true, amount, mintUrl: mintUrl!, invoice });
          }, 10 * 60 * 1000);
        });
      }
      
      // Single mint specified - original logic
      // Ensure mintUrl is always defined by this point
      if (!mintUrl) {
        throw new Error('Mint URL is undefined. This should not happen.');
      }
      
      // Add mint to wallet configuration if not already present
      if (!this.walletData.mints.includes(mintUrl)) {
        this.walletData.mints.push(mintUrl);
        this.wallet.mints = this.walletData.mints;
        this.saveWallet();
      }
      
      // 1. Initiate the deposit process
      const deposit: NDKCashuDeposit = this.wallet.deposit(amount, mintUrl);
      
      // 2. Start the deposit process and get the invoice
      const invoice = await deposit.start();
      
      console.log(invoice);
      
      // 3. Wait for the deposit to complete
      return new Promise((resolve, reject) => {
        deposit.on("success", () => {
          this.saveWallet();
          // We've ensured mintUrl is defined by this point
          resolve({ success: true, amount, mintUrl: mintUrl! });
        });
        
        deposit.on("error", (error) => {
          console.error(`❌ Deposit failed:`, error);
          reject(error);
        });
        
        // Optional: Add a timeout after 10 minutes
        setTimeout(() => {
          resolve({ timeout: true, amount, mintUrl: mintUrl!, invoice });
        }, 10 * 60 * 1000);
      });
      
    } catch (error) {
      console.error('Error creating deposit:', error);
      throw error;
    }
  }

  async pay(bolt11: string): Promise<any> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    
    try {
      const result = await this.wallet.lnPay({ pr: bolt11 });
      
      this.saveWallet();
      return result;
    } catch (error) {
      console.error('Error making payment:', error);
      throw error;
    }
  }

  async zap(recipient: string, amount: number, comment: string = ''): Promise<any> {
    if (!this.ndk || !this.wallet) throw new Error('NDK or wallet not initialized');
    
    try {
      let user;
      
      // Check if recipient looks like a pubkey (npub or hex)
      if (recipient.startsWith('npub') || (recipient.length === 64 && /^[0-9a-f]+$/i.test(recipient))) {
        // Direct pubkey - use as is
        user = this.ndk.getUser({ npub: recipient.startsWith('npub') ? recipient : nip19.npubEncode(recipient) });
      } else {
        // Assume it's a NIP-05 identifier and try to resolve it
        try {
          user = await this.ndk.getUserFromNip05(recipient);
          if (!user) {
            throw new Error(`Could not resolve NIP-05 identifier: ${recipient}`);
          }
        } catch (nip05Error) {
          throw new Error(`Failed to resolve NIP-05 identifier "${recipient}": ${nip05Error instanceof Error ? nip05Error.message : 'Unknown error'}`);
        }
      }
      
      // Use NDK's built-in zapping with the configured wallet
      const zapper = new NDKZapper(user, amount * 1000, "msat", {
        ndk: this.ndk,
        comment: comment
      });
      
      const zapResult = await zapper.zap();
      
      this.saveWallet();
      return zapResult;
    } catch (error) {
      console.error('Error sending zap:', error);
      throw error;
    }
  }

  async addMint(mintUrl: string): Promise<void> {
    if (!this.wallet || !this.walletData) throw new Error('Wallet not initialized');
    
    try {
      // Add mint to wallet if not already present
      const currentMints = this.wallet.mints || [];
      if (!currentMints.includes(mintUrl)) {
        this.wallet.mints = [...currentMints, mintUrl];
        this.walletData.mints = this.wallet.mints;
        
        
        // Republish wallet info to Nostr with updated mints
        await this.wallet.publish();
        
        // Update mint list for nutzap reception
        await this.publishMintList();
        
        this.saveWallet();
      } else {
      }
    } catch (error) {
      console.error('Error adding mint:', error);
      throw error;
    }
  }
}

// MCP Server functionality using official TypeScript SDK
class MCPServer {
  private server: Server;
  private wallet: MCPWallet;

  constructor(wallet: MCPWallet) {
    this.wallet = wallet;
    this.server = new Server(
      {
        name: "mcp-nostr-wallet",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_balance',
            description: 'Get the total wallet balance',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'get_mint_balances', 
            description: 'Get balance breakdown per mint',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'deposit',
            description: 'Create a deposit invoice (bolt11) for the specified amount and mint. Returns the invoice immediately for payment. If no mint is specified, all mints will be tried concurrently and the first successful response will be used.',
            inputSchema: {
              type: 'object',
              properties: {
                amount: { type: 'number', description: 'Amount in satoshis' },
                mintUrl: { type: 'string', description: 'Mint URL to deposit to (optional - all mints tried concurrently if not provided)' }
              },
              required: ['amount']
            }
          },
          {
            name: 'pay',
            description: 'Pay a Lightning invoice',
            inputSchema: {
              type: 'object',
              properties: {
                bolt11: { type: 'string', description: 'Lightning invoice to pay' }
              },
              required: ['bolt11']
            }
          },
          {
            name: 'zap',
            description: 'Send a zap to a user',
            inputSchema: {
              type: 'object',
              properties: {
                recipient: { type: 'string', description: 'User npub or NIP-05 identifier to zap' },
                amount: { type: 'number', description: 'Amount in satoshis' },
                comment: { type: 'string', description: 'Optional comment' }
              },
              required: ['recipient', 'amount']
            }
          },
          {
            name: 'add_mint',
            description: 'Add a mint to the wallet',
            inputSchema: {
              type: 'object',
              properties: {
                mintUrl: { type: 'string', description: 'Mint URL to add' }
              },
              required: ['mintUrl']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return await this.callTool(name, args || {});
    });
  }

  private async callTool(name: string, args: any): Promise<any> {
    switch (name) {
      case 'get_balance':
        const balance = await this.wallet.getBalance();
        return { content: [{ type: 'text', text: `Total balance: ${balance} sats` }] };

      case 'get_mint_balances':
        const balances = await this.wallet.getMintBalances();
        let balanceText = 'Balance per mint:\n';
        let total = 0;
        for (const [mintUrl, balance] of balances) {
          balanceText += `  ${mintUrl}: ${balance} sats\n`;
          total += balance;
        }
        balanceText += `Total: ${total} sats`;
        return { content: [{ type: 'text', text: balanceText }] };

      case 'deposit':
        const { amount, mintUrl } = args;
        if (!amount) {
          throw new Error('Amount is required');
        }
        const invoice = await this.wallet.createDepositInvoice(amount, mintUrl);
        return { 
          content: [{ 
            type: 'text', 
            text: `Deposit invoice created. Pay this invoice: ${invoice.bolt11}`
          }],
          invoice: invoice.bolt11,
          amount: invoice.amount,
          mintUrl: invoice.mintUrl,
          depositId: invoice.depositId
        };

      case 'pay':
        const { bolt11 } = args;
        if (!bolt11) {
          throw new Error('bolt11 invoice is required');
        }
        const payResult = await this.wallet.pay(bolt11);
        
        if (payResult && payResult.success !== false) {
          return { 
            content: [{ type: 'text', text: 'Payment successful' }],
            success: true,
            bolt11,
            payResult
          };
        } else {
          return { 
            content: [{ type: 'text', text: 'Payment failed' }],
            success: false,
            bolt11,
            payResult
          };
        }

      case 'zap':
        const { recipient, amount: zapAmount, comment = '' } = args;
        if (!recipient || !zapAmount) {
          throw new Error('recipient and amount are required');
        }
        const zapResult = await this.wallet.zap(recipient, zapAmount, comment);
        
        if (zapResult && zapResult.success !== false) {
          return { 
            content: [{ type: 'text', text: `Successfully zapped ${zapAmount} sats to ${recipient}` }],
            success: true,
            recipient,
            amount: zapAmount,
            comment,
            zapResult
          };
        } else {
          return { 
            content: [{ type: 'text', text: `Failed to zap ${zapAmount} sats to ${recipient}` }],
            success: false,
            recipient,
            amount: zapAmount,
            comment,
            zapResult
          };
        }

      case 'add_mint':
        const { mintUrl: mintToAdd } = args;
        if (!mintToAdd) {
          throw new Error('mintUrl is required');
        }
        await this.wallet.addMint(mintToAdd);
        return { content: [{ type: 'text', text: `Added mint: ${mintToAdd}` }] };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

async function runMCPServer(nsecOverride?: string): Promise<void> {
  const wallet = new MCPWallet();
  await wallet.initialize(nsecOverride);
  const server = new MCPServer(wallet);

  await server.run();
}

function parseArgs(args: string[]): { nsec?: string; command?: string; remainingArgs: string[] } {
  let nsec: string | undefined;
  let command: string | undefined;
  const remainingArgs: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--nsec' && i + 1 < args.length) {
      nsec = args[i + 1];
      i++; // Skip the nsec value
    } else if (!command) {
      command = args[i];
    } else {
      remainingArgs.push(args[i]);
    }
  }
  
  return { nsec, command, remainingArgs };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { nsec, command, remainingArgs } = parseArgs(args);

  // If no command provided, run in MCP mode
  if (!command) {
    await runMCPServer(nsec);
    return;
  }

  // CLI mode - existing functionality
  const wallet = new MCPWallet();
  await wallet.initialize(nsec);

  try {
    switch (command) {
      case 'get_balance':
        await wallet.getBalance();
        break;
        
      case 'get_mint_balances':
        await wallet.getMintBalances();
        break;
        
      case 'deposit':
        const amount = parseInt(remainingArgs[0]);
        const mintUrl = remainingArgs[1];
        if (!amount) {
          console.error('Usage: deposit <amount> [mint_url]');
          process.exit(1);
        }
        await wallet.deposit(amount, mintUrl);
        break;
        
      case 'pay':
        const bolt11 = remainingArgs[0];
        if (!bolt11) {
          console.error('Usage: pay <bolt11_invoice>');
          process.exit(1);
        }
        await wallet.pay(bolt11);
        break;
        
      case 'zap':
        const recipient = remainingArgs[0];
        const zapAmount = parseInt(remainingArgs[1]);
        const comment = remainingArgs[2] || '';
        if (!recipient || !zapAmount) {
          console.error('Usage: zap <npub_or_nip05> <amount> [comment]');
          process.exit(1);
        }
        await wallet.zap(recipient, zapAmount, comment);
        break;

      case 'add_mint':
        const mintToAdd = remainingArgs[0];
        if (!mintToAdd) {
          console.error('Usage: add_mint <mint_url>');
          process.exit(1);
        }
        await wallet.addMint(mintToAdd);
        break;
        
      default:
        console.log('Available commands:');
        console.log('  get_balance - Get total wallet balance');
        console.log('  get_mint_balances - Get balance breakdown per mint');
        console.log('  deposit <amount> [mint_url] - Create deposit invoice (all mints tried concurrently if not specified)');
        console.log('  pay <bolt11> - Pay a lightning invoice');
        console.log('  zap <npub_or_nip05> <amount> [comment] - Send a zap');
        console.log('  add_mint <mint_url> - Add a mint to the wallet');
        console.log('');
        console.log('Global options:');
        console.log('  --nsec <nsec> - Use specific nsec key (overrides env var and config)');
        console.log('');
        console.log('Run without arguments to start MCP server mode');
    }
    
    // Exit successfully after command execution
    process.exit(0);
  } catch (error) {
    console.error('Command failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}