import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PayPalButtons } from "@paypal/react-paypal-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, DollarSign, Download, Calendar, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { BillingTransaction } from "@shared/schema";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";

interface TransactionsResponse {
  transactions: BillingTransaction[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export default function BillingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [depositAmount, setDepositAmount] = React.useState(100);
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);
  const [startDate, setStartDate] = React.useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = React.useState<Date | undefined>(undefined);
  const [startDateOpen, setStartDateOpen] = React.useState(false);
  const [endDateOpen, setEndDateOpen] = React.useState(false);

  const { data: transactionData, isLoading: loadingTransactions } = useQuery<TransactionsResponse>({
    queryKey: ["/api/billing/transactions", page, limit, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("page", page.toString());
      params.append("limit", limit.toString());
      
      if (startDate) {
        params.append("startDate", startDate.toISOString());
      }
      
      if (endDate) {
        params.append("endDate", endDate.toISOString());
      }
      
      const response = await fetch(`/api/billing/transactions?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }
      return response.json();
    }
  });

  async function createOrder() {
    try {
      const response = await apiRequest("POST", "/api/billing/deposit", {
        amount: depositAmount,
        currency: "USD"
      });
      const data = await response.json();
      return data.id;
    } catch (error) {
      toast({
        title: "Error",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  }

  const onApprove = async (data: any) => {
    try {
      await apiRequest("POST", `/api/billing/capture/${data.orderID}`);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] }); // Refresh user to get updated balance
      queryClient.invalidateQueries({ queryKey: ["/api/billing/transactions"] });
      toast({
        title: "Success",
        description: "Funds have been added to your account!",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  const transactions = transactionData?.transactions || [];

  // Function to generate and download CSV of transactions
  const downloadTransactionsCSV = () => {
    if (!transactionData || transactions.length === 0) return;
    
    // Create CSV header
    const headers = ['Date', 'Type', 'Description', 'Amount', 'Status'];
    
    // Helper to escape CSV fields properly
    const escapeCSV = (field: string) => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    
    // Create CSV rows
    const rows = transactions.map(tx => [
      new Date(tx.createdAt).toLocaleString(),
      escapeCSV(tx.type),
      escapeCSV(tx.description || ''),
      tx.type === 'deposit' ? `+$${(tx.amount / 100).toFixed(2)}` : `-$${(tx.amount / 100).toFixed(2)}`,
      tx.status
    ]);
    
    // Build CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loadingTransactions) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <nav className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Billing</h1>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </nav>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-12">
        <Card>
          <CardHeader>
            <CardTitle>Current Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold mb-4">
              ${((user?.balance || 0) / 100).toFixed(2)}
            </p>
            <p className="text-muted-foreground">Add funds to your account to pay for servers and storage</p>
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">$</span>
                <input 
                  type="number" 
                  min="5"
                  step="0.01"
                  className="w-24 px-2 py-1 border rounded"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Math.max(5, Number(e.target.value)))}
                />
              </div>
              <p className="text-sm text-muted-foreground mb-4">Quick and secure payment with PayPal (Minimum $5.00)</p>
              <PayPalButtons
                style={{ layout: "vertical", label: "pay" }}
                createOrder={createOrder}
                onApprove={onApprove}
                onError={(err) => {
                  toast({
                    title: "Error",
                    description: "Payment failed. Please try again.",
                    variant: "destructive",
                  });
                  console.error("PayPal error:", err);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              <li className="flex justify-between">
                <span>1GB RAM, 1 vCPU</span>
                <span>${(0.007 * 1.005).toFixed(5)}/hour</span>
              </li>
              <li className="flex justify-between">
                <span>2GB RAM, 1 vCPU</span>
                <span>${(0.014 * 1.005).toFixed(5)}/hour</span>
              </li>
              <li className="flex justify-between">
                <span>4GB RAM, 2 vCPU</span>
                <span>${(0.028 * 1.005).toFixed(5)}/hour</span>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">Pricing includes 0.5% markup over base rates</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage & Bandwidth Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <p className="text-lg font-bold mb-1">${(0.00014 * 1.005).toFixed(6)}/GB/hour</p>
              <p className="text-sm text-muted-foreground">For block storage volumes</p>
            </div>
            <div>
              <p className="text-lg font-bold mb-1">${(0.01 * 1.005).toFixed(5)}/GB</p>
              <p className="text-sm text-muted-foreground">For bandwidth overages beyond included limit</p>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Pricing includes 0.5% markup over base rates</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Transaction History</h2>
          
          <div className="flex items-center space-x-2">
            {/* Date range selection */}
            <div className="flex items-center space-x-2">
              <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[160px] justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "MMM dd, yyyy") : <span>Start Date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => {
                      setStartDate(date);
                      setStartDateOpen(false);
                      setPage(1); // Reset to first page when filter changes
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              
              <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[160px] justify-start text-left font-normal"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "MMM dd, yyyy") : <span>End Date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => {
                      // Set end date to end of day
                      const endOfDay = date ? new Date(date.setHours(23, 59, 59, 999)) : undefined;
                      setEndDate(endOfDay);
                      setEndDateOpen(false);
                      setPage(1); // Reset to first page when filter changes
                    }}
                    initialFocus
                    disabled={(date) => 
                      startDate ? date < startDate : false
                    }
                  />
                </PopoverContent>
              </Popover>
              
              {(startDate || endDate) && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setStartDate(undefined);
                    setEndDate(undefined);
                    setPage(1);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            
            {/* Export invoices button */}
            <Button 
              variant="outline" 
              disabled={!transactionData || transactionData.transactions.length === 0}
              onClick={downloadTransactionsCSV}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>
        
        {!transactionData || transactionData.transactions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No transactions found for the selected period
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-4 mb-4">
              {transactionData.transactions.map((tx) => (
                <Card key={tx.id}>
                  <CardContent className="py-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">
                          {tx.type === 'deposit' ? 'Added Funds' : 
                           tx.type === 'server_charge' ? 'Server Charge' : 
                           tx.type === 'volume_charge' ? 'Volume Charge' :
                           tx.type === 'volume_resize_charge' ? 'Volume Resize' :
                           tx.type === 'hourly_server_charge' ? 'Hourly Server Charge' :
                           tx.type === 'hourly_volume_charge' ? 'Hourly Volume Charge' :
                           tx.type === 'bandwidth_overage' ? 'Bandwidth Overage' :
                           tx.type === 'server_deleted_insufficient_funds' ? 'Server Deleted (Insufficient Funds)' :
                           'Charge'}
                        </p>
                        {tx.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {tx.description}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          {new Date(tx.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-lg ${tx.type === 'deposit' ? 'text-green-600' : 'text-red-600'}`}>
                          {tx.type === 'deposit' ? '+' : '-'}${(tx.amount / 100).toFixed(2)}
                        </span>
                        <Badge variant={tx.status === "completed" ? "default" : "secondary"}>
                          {tx.status}
                        </Badge>
                        {tx.status === "completed" && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => window.open(`/api/billing/transactions/${tx.id}/invoice`)}
                            title="View invoice details"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            
            {/* Pagination controls */}
            {transactionData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-muted-foreground">
                  Showing {(transactionData.pagination.page - 1) * transactionData.pagination.limit + 1} to {
                    Math.min(transactionData.pagination.page * transactionData.pagination.limit, transactionData.pagination.total)
                  } of {transactionData.pagination.total} transactions
                </div>
                
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={!transactionData.pagination.hasPrevPage}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  
                  <div className="flex items-center text-sm">
                    Page {transactionData.pagination.page} of {transactionData.pagination.totalPages}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={!transactionData.pagination.hasNextPage}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}