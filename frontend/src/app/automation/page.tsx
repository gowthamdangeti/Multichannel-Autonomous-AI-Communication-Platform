"use client";

import { Zap } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/context/HeaderContext';

export default function AutomationPage() {
    return (
        <div className="px-4 lg:px-6 pt-2 pb-6 space-y-4">
            <PageHeader
                title="Automation"
                subtitle="Automate your workflows and processes"
            />

            <Card>
                <CardHeader>
                    <CardTitle>Coming Soon</CardTitle>
                    <CardDescription>
                        Automation features are currently under development
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-12">
                        <Zap className="w-16 h-16 mx-auto mb-6" />
                        <p className="text-lg mb-4">
                            We&apos;re working on powerful automation features to help you streamline your workflows.
                        </p>
                        <p>
                            Automate repetitive tasks, trigger actions based on events, and create intelligent workflow pipelines.
                        </p>
                        <p className="mt-4">
                            Check back soon for updates!
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
