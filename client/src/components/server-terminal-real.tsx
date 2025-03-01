import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { io } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { RefreshCw, Maximize2, Minimize2, AlertCircle, Lock, Key } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import 'xterm/css/xterm.css';

interface ServerTerminalProps {
  serverId: number;
  serverName: string;
  ipAddress: string;
}

export default function ServerTerminal({ serverId, serverName, ipAddress }: ServerTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [waitingForPassword, setWaitingForPassword] = useState(false);
  const socketRef = useRef<any>(null);
  const { user } = useAuth();
  
  // Get the server's root password from the API
  const { data: serverDetails, isLoading: loadingPassword, error: passwordError } = useQuery<{ rootPassword?: string, id: number }>({
    queryKey: [`/api/servers/${serverId}/details`],
    enabled: !isNaN(serverId) && !!user,
    // Add some stale time to avoid too many refreshes
    staleTime: 10000,
    // Add a refetchInterval to ensure we always have the latest password
    refetchInterval: 30000,
    retry: 3,
  });
  
  // Log password availability for debugging
  useEffect(() => {
    if (serverDetails) {
      console.log(`[Terminal Debug] Server ${serverId} password status:`, {
        hasPassword: !!serverDetails.rootPassword,
        passwordLength: serverDetails.rootPassword?.length || 0
      });
    } else if (passwordError) {
      console.error(`[Terminal Debug] Error fetching password:`, passwordError);
    } else if (loadingPassword) {
      console.log(`[Terminal Debug] Loading password data...`);
    }
  }, [serverDetails, passwordError, loadingPassword, serverId]);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || !user) return;

    // Clear any existing terminal
    terminalRef.current.innerHTML = '';
    
    console.log("Terminal initializing, root password available:", !!serverDetails?.rootPassword);

    // Initialize XTerm
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#f7f7f7',
        selectionBackground: 'rgba(128, 203, 196, 0.3)',
        black: '#32344a',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#ad8ee6',
        cyan: '#449dab',
        white: '#787c99',
        brightBlack: '#444b6a',
        brightRed: '#ff7a93',
        brightGreen: '#b9f27c',
        brightYellow: '#ff9e64',
        brightBlue: '#7da6ff',
        brightMagenta: '#bb9af7',
        brightCyan: '#0db9d7',
        brightWhite: '#acb0d0',
      }
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // Open terminal in the container
    term.open(terminalRef.current);
    fit.fit();

    // Store references
    setTerminal(term);
    setFitAddon(fit);

    // Handle window resize
    const handleResize = () => {
      if (fit) fit.fit();
    };
    window.addEventListener('resize', handleResize);

    // Initial connection
    connectToServer(term);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [serverId, user, serverDetails]);

  // Handle full screen mode changes
  useEffect(() => {
    if (fitAddon) {
      setTimeout(() => {
        fitAddon.fit();
      }, 100);
    }
  }, [isFullScreen, fitAddon]);

  // Connect to WebSocket server
  const connectToServer = (term: Terminal) => {
    try {
      setConnectionError(null);
      
      term.clear();
      term.writeln('\x1b[1;32mInitiating connection to server...\x1b[0m');
      term.writeln(`\x1b[1;34mConnecting to ${serverName} (${ipAddress})...\x1b[0m`);
      term.writeln('\x1b[1;33mNote: Connection may take up to 30 seconds for new servers\x1b[0m');
      
      // Create a socket.io connection to the server with query parameters
      // Add enhanced reconnection options to fix connection issues
      const socket = io(`${window.location.origin}`, {
        query: {
          serverId: serverId.toString(),
          userId: user?.id.toString()
        },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000, // Increase timeout for slower connections
        forceNew: true  // Force a new connection to avoid socket reuse issues
      });
      
      socketRef.current = socket;
      
      // Handle socket events
      socket.on('connect', () => {
        console.log('Socket connected to backend');
        term.writeln('\x1b[1;32mEstablished connection to CloudRack...\x1b[0m');
        term.writeln('\x1b[1;33mAttempting SSH connection to server...\x1b[0m');
      });
      
      socket.on('status', (data: { status: string, message?: string }) => {
        console.log('[Terminal] Status update:', data.status, data.message);
        
        if (data.status === 'connecting') {
          term.writeln('\x1b[1;33mEstablishing secure connection...\x1b[0m');
        } else if (data.status === 'connected') {
          setIsConnected(true);
          term.writeln('\x1b[1;32mSecure connection established!\x1b[0m');
          term.writeln('\x1b[1;32m-----------------------------------------\x1b[0m');
          term.writeln('\x1b[1;32mWelcome to CloudRack Terminal Access\x1b[0m');
          term.writeln('\x1b[1;32m-----------------------------------------\x1b[0m');
          // Display message if provided (like authentication method used)
          if (data.message) {
            term.writeln(`\x1b[1;34m${data.message}\x1b[0m`);
          }
        } else if (data.status === 'disconnected') {
          setIsConnected(false);
          term.writeln('\x1b[1;31mConnection closed.\x1b[0m');
        } else if (data.status === 'password_auth') {
          term.writeln('\x1b[1;33mUsing password authentication...\x1b[0m');
        } else if (data.status === 'key_auth') {
          term.writeln('\x1b[1;33mUsing CloudRack Terminal Key authentication...\x1b[0m');
        } else if (data.status === 'auth_in_progress') {
          term.writeln('\x1b[1;33mAuthenticating: ' + (data.message || 'Verifying credentials...') + '\x1b[0m');
        }
        
        // If there's a message but we didn't handle it above, display it
        if (data.message && !['connected', 'auth_in_progress'].includes(data.status)) {
          term.writeln(`\x1b[1;36m${data.message}\x1b[0m`);
        }
      });
      
      socket.on('data', (data: string) => {
        term.write(data);
      });
      
      socket.on('error', (error: string) => {
        console.error('Terminal error:', error);
        setConnectionError(error);
        term.writeln(`\x1b[1;31mError: ${error}\x1b[0m`);
        
        // Provide detailed information based on common error types
        if (error.includes('timeout') || error.includes('Connection refused') || error.includes('ECONNREFUSED')) {
          term.writeln('\x1b[1;33m---------- CONNECTION TROUBLESHOOTING ----------\x1b[0m');
          term.writeln('\x1b[1;33m• New servers may take up to 5 minutes to complete setup\x1b[0m');
          term.writeln('\x1b[1;33m• The server may be rebooting or initializing\x1b[0m');
          term.writeln('\x1b[1;33m• Server firewall may be blocking connections\x1b[0m');
          term.writeln('\x1b[1;33m----------------------------------------------\x1b[0m');
          term.writeln('\x1b[1;32mRecommendation: Wait a few minutes and try reconnecting\x1b[0m');
          term.writeln('\x1b[1;32mOr click "Reboot" on the server actions menu\x1b[0m');
        } else if (error.includes('Authentication failed') || error.includes('auth fail') || error.includes('permission denied')) {
          term.writeln('\x1b[1;33m---------- AUTHENTICATION TROUBLESHOOTING ----------\x1b[0m');
          if (serverDetails?.rootPassword) {
            term.writeln('\x1b[1;33m• Root password authentication failed\x1b[0m');
            term.writeln('\x1b[1;33m• The stored password may be incorrect or outdated\x1b[0m');
            term.writeln('\x1b[1;33m• Try resetting your root password\x1b[0m');
          } else {
            term.writeln('\x1b[1;33m• SSH key authentication failed\x1b[0m');
            term.writeln('\x1b[1;33m• SSH keys may be missing or changed on the server\x1b[0m');
          }
          term.writeln('\x1b[1;33m--------------------------------------------------\x1b[0m');
          term.writeln('\x1b[1;32mRecommendation: Try setting a new root password\x1b[0m');
        } else if (error.includes('Host key verification failed')) {
          term.writeln('\x1b[1;33m---------- HOST KEY VERIFICATION ISSUE ----------\x1b[0m');
          term.writeln('\x1b[1;33m• The server\'s SSH host key has changed\x1b[0m');
          term.writeln('\x1b[1;33m• This typically happens after server rebuilds\x1b[0m');
          term.writeln('\x1b[1;33m• CloudRack will automatically resolve this issue\x1b[0m');
          term.writeln('\x1b[1;33m-----------------------------------------------\x1b[0m');
          term.writeln('\x1b[1;32mRecommendation: Try connecting again\x1b[0m');
        } else {
          term.writeln('\x1b[1;33m---------- GENERAL TROUBLESHOOTING ----------\x1b[0m');
          term.writeln('\x1b[1;33m• The connection encountered an unexpected error\x1b[0m');
          term.writeln('\x1b[1;33m• Try rebooting the server if it persists\x1b[0m');
          term.writeln('\x1b[1;33m• Contact support if you need additional help\x1b[0m');
          term.writeln('\x1b[1;33m-------------------------------------------\x1b[0m');
        }
        
        term.writeln('\x1b[1;36mClick "Reconnect" to try connecting again\x1b[0m');
        setIsConnected(false);
      });
      
      socket.on('disconnect', () => {
        setIsConnected(false);
        term.writeln('\x1b[1;31mDisconnected from server.\x1b[0m');
        term.writeln('\x1b[1;33mClick "Reconnect" to try connecting again.\x1b[0m');
      });
      
      // Handle authentication request (server asking for password)
      socket.on('auth_request', (data: { prompt: string }) => {
        term.writeln('\x1b[1;33mServer requesting authentication...\x1b[0m');
        
        // If we have a root password stored, use it automatically
        if (serverDetails?.rootPassword) {
          term.writeln('\x1b[1;32mUsing stored root password for authentication\x1b[0m');
          socket.emit('data', serverDetails.rootPassword + '\n');
          return;
        }
        
        // Otherwise, show the prompt and let the user enter password
        setWaitingForPassword(true);
        term.write(data.prompt);
        setAuthStatus('Waiting for password input...');
      });
      
      // Handle user input in the terminal
      term.onData((data) => {
        if (socket && socket.connected) {
          socket.emit('data', data);
        }
      });
      
      // Handle terminal resize
      const handleTerminalResize = () => {
        if (socket && socket.connected) {
          socket.emit('resize', {
            cols: term.cols,
            rows: term.rows
          });
        }
      };
      
      // Set up resize handler
      if (fitAddon) {
        // Store the original fit function
        const originalFit = fitAddon.fit;
        
        // Override the fit function to emit a resize event after fitting
        fitAddon.fit = function() {
          originalFit.call(fitAddon);
          handleTerminalResize();
        };
      }
      
    } catch (error: any) {
      console.error('Failed to connect to terminal server:', error);
      setConnectionError('Failed to connect to terminal server. Please try again.');
      setIsConnected(false);
    }
  };

  // Reconnect terminal
  const handleReconnect = () => {
    if (terminal) {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      terminal.clear();
      connectToServer(terminal);
    }
  };

  // Toggle full screen mode
  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
  };

  return (
    <div className={`relative w-full ${isFullScreen ? 'fixed inset-0 z-50 bg-background p-6' : ''}`}>
      {connectionError && (
        <div className="bg-red-500/10 text-red-500 p-3 rounded-md mb-4">
          {connectionError}
        </div>
      )}
      
      <div 
        className={`
          border rounded-md overflow-hidden w-full mx-auto
          ${isFullScreen ? 'h-[calc(100vh-100px)]' : 'h-[400px]'}
        `}
      >
        <div className="bg-gray-800 text-gray-300 p-2 flex justify-between items-center text-xs">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <div className="flex flex-col">
              <span>{isConnected ? 'Connected' : 'Disconnected'} - {serverName} ({ipAddress})</span>
              {serverDetails?.rootPassword ? (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Password authentication enabled
                </span>
              ) : (
                <span className="text-xs text-blue-400 flex items-center gap-1">
                  <Key className="h-3 w-3" /> CloudRack Terminal Key authentication
                </span>
              )}
            </div>
          </div>
          <div className="flex space-x-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6" 
              onClick={handleReconnect}
              title="Reconnect"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6" 
              onClick={toggleFullScreen}
              title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
            >
              {isFullScreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
        <div 
          ref={terminalRef} 
          className="h-full w-full"
        />
      </div>
      
      {isFullScreen && (
        <div className="absolute bottom-6 right-6">
          <Button 
            variant="secondary" 
            onClick={toggleFullScreen}
          >
            <Minimize2 className="h-4 w-4 mr-2" />
            Exit Full Screen
          </Button>
        </div>
      )}
    </div>
  );
}