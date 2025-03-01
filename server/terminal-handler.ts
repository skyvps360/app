import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { Client as SSHClient, ClientChannel } from 'ssh2';
import { storage } from './storage';
import { log } from './vite';
import { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { cloudRackKeyManager } from './cloudrack-key-manager';

// Extend the Server type to include rootPassword
interface ExtendedServer {
  id: number;
  userId: number;
  name: string;
  dropletId: string;
  region: string;
  size: string;
  status: string;
  ipAddress: string | null;
  ipv6Address: string | null;
  specs: { memory: number; vcpus: number; disk: number; } | null;
  application: string | null;
  lastMonitored: Date | null;
  // Add rootPassword property that may be present
  rootPassword?: string;
}

export function setupTerminalSocket(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });
  
  io.on('connection', async (socket) => {
    const serverId = socket.handshake.query.serverId as string;
    const userId = socket.handshake.query.userId as string;
    
    if (!serverId || !userId) {
      socket.emit('error', 'Missing server ID or user ID');
      socket.disconnect();
      return;
    }
    
    log(`Terminal connection request for server ${serverId} from user ${userId}`, 'terminal');
    
    try {
      // Verify server ownership
      const server = await storage.getServer(parseInt(serverId)) as unknown as ExtendedServer;
      if (!server) {
        socket.emit('error', 'Server not found');
        socket.disconnect();
        return;
      }
      
      if (server.userId !== parseInt(userId)) {
        socket.emit('error', 'Unauthorized access to server');
        socket.disconnect();
        return;
      }
      
      // Connect to the server via SSH
      const sshClient = new SSHClient();
      let sshStream: ClientChannel | null = null;
      
      socket.emit('status', { status: 'connecting' });
      
      sshClient.on('ready', () => {
        // Determine which authentication method was used and notify the client
        if (server.rootPassword) {
          log(`Connected to server ${server.id} using password authentication`, 'terminal');
          socket.emit('status', { 
            status: 'password_auth'
          });
        } else {
          log(`Connected to server ${server.id} using CloudRack Terminal Key authentication`, 'terminal');
          socket.emit('status', { 
            status: 'key_auth'
          });
        }
          
        // Then emit the connected status after a short delay to ensure sequence
        setTimeout(() => {
          socket.emit('status', { 
            status: 'connected',
            message: server.rootPassword 
              ? 'Using password authentication (root password)'
              : 'Using CloudRack Terminal Key authentication (SSH key)'
          });
        }, 100);
        
        // Create a new shell session
        sshClient.shell((err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            socket.emit('error', `Failed to create shell: ${err.message}`);
            socket.disconnect();
            return;
          }
          
          sshStream = stream;
          
          // Forward data from SSH to the client
          stream.on('data', (data: Buffer) => {
            socket.emit('data', data.toString('utf-8'));
          });
          
          stream.on('close', () => {
            socket.emit('status', { status: 'disconnected' });
            sshClient.end();
          });
          
          stream.stderr.on('data', (data: Buffer) => {
            socket.emit('data', data.toString('utf-8'));
          });
        });
      });
      
      sshClient.on('error', (err) => {
        log(`SSH connection error: ${err.message}`, 'terminal');
        socket.emit('error', `SSH connection error: ${err.message}`);
        socket.disconnect();
      });
      
      sshClient.on('close', () => {
        socket.emit('status', { status: 'disconnected' });
      });
      
      sshClient.on('end', () => {
        socket.emit('status', { status: 'disconnected' });
      });
      
      // Handle connection to the server
      const connectSSH = async () => {
        try {
          if (!server.ipAddress) {
            throw new Error('Server IP address is not available');
          }
          
          // Log connection attempt for debugging
          log(`Attempting SSH connection to ${server.ipAddress} for server ${server.id}`, 'terminal');
          
          // Verify that user has CloudRack key
          const hasKey = await cloudRackKeyManager.hasCloudRackKey(parseInt(userId));
          if (!hasKey) {
            throw new Error('CloudRack Terminal Key not found in your account. Please contact support.');
          }
          
          // Get the CloudRack SSH private key path
          const keyPath = cloudRackKeyManager.getCloudRackPrivateKeyPath();
          
          // Check if the CloudRack SSH private key exists
          if (!fs.existsSync(keyPath)) {
            throw new Error('CloudRack SSH key not found on server. Terminal functionality is disabled.');
          }
          
          // Read the CloudRack SSH private key
          let privateKey = fs.readFileSync(keyPath, 'utf8');
          
          // Check private key format
          if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') || !privateKey.includes('-----END RSA PRIVATE KEY-----')) {
            log('Invalid SSH private key format. Attempting to regenerate CloudRack keys.', 'terminal');
            
            // Force regeneration of keys - we need to access the private method
            try {
              await (cloudRackKeyManager as any).regenerateKeys();
              
              // Re-read the private key after regeneration
              if (fs.existsSync(keyPath)) {
                const newPrivateKey = fs.readFileSync(keyPath, 'utf8');
                if (newPrivateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
                  log('Successfully regenerated CloudRack keys with correct format', 'terminal');
                  // Use the new key
                  privateKey = newPrivateKey;
                } else {
                  throw new Error('Failed to generate key in correct format after retry');
                }
              } else {
                throw new Error('Key file not found after regeneration attempt');
              }
            } catch (regenerationError) {
              log(`Failed to regenerate keys: ${regenerationError}`, 'terminal');
              throw new Error('Invalid SSH private key format. Terminal functionality is unavailable.');
            }
          }
          
          // Log connection attempt with key format info (masked)
          log(`Connecting to ${server.ipAddress} with key in format: ${privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') ? 'RSA PEM' : 'OTHER PEM'}`, 'terminal');
          
          // Determine if we should use password or key-based authentication
          const connectionConfig: any = {
            host: server.ipAddress,
            port: 22,
            username: 'root',
            readyTimeout: 60000, // Extended timeout even further
            keepaliveInterval: 5000,
            // Don't retry too many times to avoid auth lockouts
            retries: 1,
            retry_delay: 2000,
            // Explicitly set authentication method to password 
            authHandler: null, // We will set our own auth handler
            // Set explicit algorithms for better compatibility with older servers
            algorithms: {
              kex: [
                'diffie-hellman-group-exchange-sha256',
                'diffie-hellman-group14-sha256',
                'diffie-hellman-group14-sha1',
                'diffie-hellman-group1-sha1'
              ],
              cipher: [
                'aes128-ctr',
                'aes192-ctr',
                'aes256-ctr',
                'aes128-gcm',
                'aes256-gcm',
                'aes128-cbc',
                'aes256-cbc'
              ],
              serverHostKey: [
                'ssh-rsa',
                'ssh-dss',
                'ecdsa-sha2-nistp256',
                'ecdsa-sha2-nistp384',
                'ecdsa-sha2-nistp521'
              ],
              hmac: [
                'hmac-sha2-256',
                'hmac-sha2-512',
                'hmac-sha1'
              ]
            },
            debug: (message: string) => {
              // Always log SSH debug messages for troubleshooting terminal issues
              log(`SSH Debug: ${message}`, 'terminal');
            }
          };
          
          // Only use password authentication for improved reliability
          if (server.rootPassword) {
            log(`Using password authentication for server ${server.id}`, 'terminal');
            connectionConfig.password = server.rootPassword;
            
            // Remove options that may interfere with password auth
            connectionConfig.privateKey = undefined;
            
            // Tell client we're using password auth
            socket.emit('status', { 
              status: 'connecting',
              message: 'Using stored root password for authentication'
            });
          } else {
            log('No root password available for authentication', 'terminal');
            socket.emit('error', 'No password is set for this server. Please set a root password to use the terminal.');
            throw new Error('Root password required for terminal access');
          }
          
          // Always try keyboard-interactive as fallback
          connectionConfig.tryKeyboard = true;
          
          // Add keyboard-interactive handler for password prompt fallback
          connectionConfig.authHandler = (methodsLeft: string[], partialSuccess: boolean, callback: Function) => {
            // Guard against null or undefined methodsLeft
            if (!methodsLeft || !Array.isArray(methodsLeft)) {
              log('Warning: Auth methods list is invalid', 'terminal');
              if (server.rootPassword) {
                return callback('password');
              }
              socket.emit('error', 'No authentication methods available. Please set a root password for your server.');
              return callback(null);
            }
            
            // Safely log available methods
            log(`SSH auth methods left: ${methodsLeft.join ? methodsLeft.join(', ') : String(methodsLeft)}`, 'terminal');
            
            // SIMPLIFIED AUTHENTICATION - ONLY USE PASSWORD
            // Only proceed if we have a root password set for the server
            if (!server.rootPassword) {
              log('No root password available for authentication', 'terminal');
              socket.emit('error', 'No password is set for this server. Please set a root password to use the terminal.');
              return callback(null);
            }
            
            // Try password auth first if available
            if (methodsLeft.includes('password')) {
              log('Using password auth method with stored root password', 'terminal');
              return callback('password');
            } 
            // Then try keyboard-interactive which will also use the password
            else if (methodsLeft.includes('keyboard-interactive')) {
              log('Using keyboard-interactive auth method with root password', 'terminal');
              return callback('keyboard-interactive');
            }
            // As a last resort, try none - just in case the server allows it
            else if (methodsLeft.includes('none')) {
              log('Trying none auth method (unlikely to work)', 'terminal');
              return callback('none');
            }
            // Otherwise, report that no suitable auth methods are available
            else {
              log('No supported auth methods available', 'terminal');
              socket.emit('error', 'Server does not support password authentication. Please contact support.');
              return callback(null);
            }
          };
          
          // Handle keyboard-interactive challenges
          sshClient.on('keyboard-interactive', (name: string, instructions: string, instructionsLang: string, prompts: any[], finish: Function) => {
            log(`Received keyboard-interactive prompt: ${name}`, 'terminal');
            
            // If there are no prompts, just finish
            if (prompts.length === 0) {
              return finish([]);
            }
            
            // If we have a root password and the prompt is asking for a password, use it
            if (server.rootPassword && prompts.some((p: any) => p.prompt.toLowerCase().includes('password'))) {
              log('Responding to password prompt with stored root password', 'terminal');
              finish([server.rootPassword]);
            } else {
              // Otherwise, we need to pass the prompt to the client
              log('Passing keyboard-interactive prompt to client', 'terminal');
              socket.emit('auth_request', { 
                prompt: prompts[0].prompt 
              });
              
              // Wait for client response (this will handle the first prompt only)
              const handleResponse = (data: string) => {
                socket.off('data', handleResponse);
                finish([data.trim()]);
              };
              
              socket.on('data', handleResponse);
            }
          });
          
          sshClient.connect(connectionConfig);
        } catch (error: any) {
          log(`SSH connection error: ${error.message}`, 'terminal');
          socket.emit('error', `Failed to connect: ${error.message}`);
        }
      }
      
      // Handle data from the client to the SSH server
      socket.on('data', (data) => {
        if (sshStream) {
          sshStream.write(data);
        }
      });
      
      // Handle resize events
      socket.on('resize', (data: { rows: number, cols: number }) => {
        if (sshStream) {
          try {
            // Use proper SSH window size parameters
            sshStream.setWindow(data.rows, data.cols, data.cols * 8, data.rows * 10);
          } catch (err) {
            log(`Terminal resize error: ${err}`, 'terminal');
          }
        }
      });
      
      // Handle disconnect
      socket.on('disconnect', () => {
        if (sshClient) {
          sshClient.end();
        }
      });
      
      // Start connection process
      connectSSH().catch(err => {
        log(`Terminal connection failed: ${err.message}`, 'terminal');
        socket.emit('error', `Terminal connection failed: ${err.message}`);
        socket.disconnect();
      });
      
    } catch (error: any) {
      log(`Terminal error: ${error.message}`, 'terminal');
      socket.emit('error', `Terminal error: ${error.message}`);
      socket.disconnect();
    }
  });
  
  return io;
}