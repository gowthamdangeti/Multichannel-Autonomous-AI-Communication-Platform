"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Eye, EyeOff, Key, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    archiveApiKeyApiV1UserApiKeysApiKeyIdDelete,
    createApiKeyApiV1UserApiKeysPost,
    getApiKeysApiV1UserApiKeysGet,
    reactivateApiKeyApiV1UserApiKeysApiKeyIdReactivatePut
} from '@/client/sdk.gen';
import type { ApiKeyResponse, CreateApiKeyResponse } from '@/client/types.gen';
import { PageSearchInput } from "@/components/layout/PageSearchInput";
import { RowAction, RowActionsMenu } from "@/components/layout/RowActionsMenu";
import { TablePagination } from "@/components/layout/TablePagination";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/context/HeaderContext';
import { usePagination } from "@/hooks/usePagination";
import { useAuth } from '@/lib/auth';
import { filterBySearch } from "@/lib/searchFilter";

export default function APIKeysPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();

    const [apiKeys, setApiKeys] = useState<ApiKeyResponse[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null);
    const [showCreatedKeyDialog, setShowCreatedKeyDialog] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchApiKeys = useCallback(async () => {
        // Follow the pattern from UserConfigContext - check both loading and user
        if (loading || !user) {
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await getApiKeysApiV1UserApiKeysGet({
                query: {
                    include_archived: showArchived
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setApiKeys(response.data);
            }
        } catch (err) {
            setError('Failed to fetch API keys');
            console.error('Error fetching API keys:', err);
        } finally {
            setIsLoading(false);
        }
    }, [loading, user, getAccessToken, showArchived]);

    useEffect(() => {
        fetchApiKeys();
    }, [fetchApiKeys]);

    const handleCreateKey = async () => {
        if (!newKeyName.trim()) {
            setError('Please enter a name for the API key');
            return;
        }

        try {
            setError(null);
            const accessToken = await getAccessToken();

            const response = await createApiKeyApiV1UserApiKeysPost({
                body: {
                    name: newKeyName
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCreatedKey(response.data);
                setIsCreateDialogOpen(false);
                setShowCreatedKeyDialog(true);
                setNewKeyName('');
                fetchApiKeys();
            }
        } catch (err) {
            setError('Failed to create API key');
            console.error('Error creating API key:', err);
        }
    };

    const handleArchiveKey = async (keyId: number) => {
        try {
            setError(null);
            const accessToken = await getAccessToken();

            await archiveApiKeyApiV1UserApiKeysApiKeyIdDelete({
                path: {
                    api_key_id: keyId
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            fetchApiKeys();
        } catch (err) {
            setError('Failed to archive API key');
            console.error('Error archiving API key:', err);
        }
    };

    const handleReactivateKey = async (keyId: number) => {
        try {
            setError(null);
            const accessToken = await getAccessToken();

            await reactivateApiKeyApiV1UserApiKeysApiKeyIdReactivatePut({
                path: {
                    api_key_id: keyId
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            fetchApiKeys();
        } catch (err) {
            setError('Failed to reactivate API key');
            console.error('Error reactivating API key:', err);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
        }
    };

    // Header sorting (client-side, current list only; null = server order).
    type ApiKeySortKey = 'id' | 'name' | 'created_at' | 'last_used_at' | 'status';
    const [sortKey, setSortKey] = useState<ApiKeySortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const toggleSort = (key: ApiKeySortKey) => {
        if (sortKey !== key) {
            setSortKey(key);
            setSortDir('asc');
        } else if (sortDir === 'asc') {
            setSortDir('desc');
        } else {
            setSortKey(null);
            setSortDir('asc');
        }
    };
    const SortIcon = ({ column }: { column: ApiKeySortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
        return sortDir === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
            : <ArrowDown className="h-3.5 w-3.5 text-foreground" />;
    };
    const sortedApiKeys = useMemo(() => {
        if (!sortKey) return apiKeys;
        const dir = sortDir === 'asc' ? 1 : -1;
        const statusRank = (k: ApiKeyResponse) => (k.archived_at ? 2 : k.is_active ? 0 : 1);
        return [...apiKeys].sort((a, b) => {
            switch (sortKey) {
                case 'id':
                    return (a.id - b.id) * dir;
                case 'name':
                    return (a.name ?? '').localeCompare(b.name ?? '') * dir;
                case 'created_at':
                    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
                case 'last_used_at':
                    return ((a.last_used_at ? new Date(a.last_used_at).getTime() : -1) - (b.last_used_at ? new Date(b.last_used_at).getTime() : -1)) * dir;
                case 'status':
                    return (statusRank(a) - statusRank(b)) * dir;
            }
        });
    }, [apiKeys, sortKey, sortDir]);
    const visibleApiKeys = filterBySearch(sortedApiKeys, searchQuery, (key) => key.name);
    const keyPagination = usePagination(visibleApiKeys);

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    // Don't render content until auth is loaded
    if (loading || !user) {
        return (
            <div className="px-4 lg:px-6 pt-2 pb-6 flex items-center justify-center min-h-[400px]">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-96" />
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
            <PageHeader
                title="Developer Portal"
                subtitle="Manage your API keys to access Convozent services programmatically"
                onRefresh={() => void fetchApiKeys()}
                isRefreshing={isLoading}
                primaryAction={<Button onClick={() => setIsCreateDialogOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Create New Key
                    </Button>}
                toolbar={<>
                        <PageSearchInput placeholder="Search API keys..." value={searchQuery} onChange={setSearchQuery} />
                        <Button variant="outline" onClick={() => setShowArchived(!showArchived)}>
                            {showArchived ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
                            {showArchived ? 'Hide' : 'Show'} Archived
                        </Button>
                    </>}
            />

            {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                    {error}
                </div>
            )}

            <Card>
                <CardContent className="p-0 overflow-hidden">
                    {isLoading ? (
                        <div className="p-6 space-y-4">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-24" />
                                    </div>
                                    <Skeleton className="h-8 w-20" />
                                </div>
                            ))}
                        </div>
                    ) : apiKeys.length === 0 ? (
                        <div className="text-center py-12">
                            <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                            <p className="text-muted-foreground mb-4">No API keys found</p>
                            <Button onClick={() => setIsCreateDialogOpen(true)}>
                                Create Your First API Key
                            </Button>
                        </div>
                    ) : (
                        <>
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="font-semibold text-muted-foreground pl-6">
                                        <button onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by ID">
                                            ID <SortIcon column="id" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-muted-foreground">
                                        <button onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by name">
                                            Name <SortIcon column="name" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-muted-foreground">Key Prefix</TableHead>
                                    <TableHead className="font-semibold text-muted-foreground">
                                        <button onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by created date">
                                            Created Date <SortIcon column="created_at" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-muted-foreground">
                                        <button onClick={() => toggleSort('last_used_at')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by last used">
                                            Last Used <SortIcon column="last_used_at" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-muted-foreground">
                                        <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" aria-label="Sort by status">
                                            Status <SortIcon column="status" />
                                        </button>
                                    </TableHead>
                                    <TableHead className="font-semibold text-muted-foreground pr-6 w-[100px] text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {keyPagination.pageItems.map((key) => (
                                    <TableRow
                                        key={key.id}
                                        className={`hover:bg-accent/50 transition-colors ${
                                            key.archived_at ? 'opacity-60 bg-muted/30' : ''
                                        }`}
                                    >
                                        <TableCell className="text-muted-foreground font-mono text-xs pl-6">
                                            #{key.id}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {key.name}
                                        </TableCell>
                                        <TableCell className="text-foreground text-xs whitespace-nowrap">
                                            <span className="font-mono bg-muted px-2 py-1 rounded">{key.key_prefix}...</span>
                                        </TableCell>
                                        <TableCell className="text-foreground font-medium text-sm whitespace-nowrap">
                                            {formatDate(key.created_at)}
                                        </TableCell>
                                        <TableCell className="text-foreground font-medium text-sm whitespace-nowrap">
                                            {formatDate(key.last_used_at ?? null)}
                                        </TableCell>
                                        <TableCell>
                                            {key.archived_at ? (
                                                <Badge variant="secondary" className="font-medium">Archived</Badge>
                                            ) : key.is_active ? (
                                                <Badge variant="success" className="font-medium">Active</Badge>
                                            ) : (
                                                <Badge variant="destructive" className="font-medium">Inactive</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <RowActionsMenu label={`Actions for ${key.name}`}>
                                                {key.archived_at ? (
                                                    <RowAction icon={<RefreshCw />} onClick={() => handleReactivateKey(key.id)}>Reactivate</RowAction>
                                                ) : (
                                                    <RowAction icon={<Trash2 />} onClick={() => handleArchiveKey(key.id)} destructive>Revoke</RowAction>
                                                )}
                                            </RowActionsMenu>
</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <TablePagination {...keyPagination} />
                        </>
                    )}
                </CardContent>
            </Card>

            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-sm text-yellow-600 dark:text-yellow-500">
                    <strong>Important:</strong> Keep your API keys secure. Never share them publicly or commit them to version control.
                    API keys provide full access to your organization&apos;s resources.
                </p>
            </div>

            {/* Create API Key Dialog */}
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New API Key</DialogTitle>
                        <DialogDescription>
                            Enter a descriptive name for your API key to help you identify it later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Key Name</Label>
                            <Input
                                id="name"
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                placeholder="e.g., Production Server, Development Environment"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreateKey}>
                            Create Key
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Show Created Key Dialog */}
            <Dialog open={showCreatedKeyDialog} onOpenChange={setShowCreatedKeyDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>API Key Created Successfully</DialogTitle>
                        <DialogDescription>
                            Make sure to copy your API key now. You won&apos;t be able to see it again!
                        </DialogDescription>
                    </DialogHeader>
                    {createdKey && (
                        <div className="space-y-4">
                            <div className="p-4 bg-muted rounded-lg">
                                <p className="text-sm text-muted-foreground mb-2">Your API Key:</p>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 p-2 bg-background rounded text-sm font-mono break-all">
                                        {createdKey.api_key}
                                    </code>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => copyToClipboard(createdKey.api_key)}
                                    >
                                        <Copy className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <p className="text-sm text-yellow-600 dark:text-yellow-500">
                                    Store this key securely. It will only be shown once and cannot be retrieved later.
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button onClick={() => {
                            setShowCreatedKeyDialog(false);
                            setCreatedKey(null);
                        }}>
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
