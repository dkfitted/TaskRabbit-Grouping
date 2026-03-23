"use client";

import { useState } from "react";
import VerifyPage from "@/components/VerifyPage";
import UploadPage from "@/components/UploadPage";

export type AppStage = "verify" | "upload" | "success";

export interface VerifiedSession {
  taskRabbitId: string;
}

export default function App() {
  const [stage, setStage] = useState<AppStage>("verify");
  const [session, setSession] = useState<VerifiedSession | null>(null);
  const [result, setResult] = useState<{ itemCount: number; photoCount: number } | null>(null);

  if (stage === "success" && result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="text-center max-w-xs">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center mb-3">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold">Done!</h1>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            {result.itemCount} items uploaded to Fitted
          </p>
          <button
            onClick={() => {
              setStage("verify");
              setSession(null);
              setResult(null);
            }}
            className="w-full h-12 bg-black text-white font-medium rounded-xl"
          >
            Next customer
          </button>
        </div>
      </div>
    );
  }

  if (stage === "upload" && session) {
    return (
      <UploadPage
        session={session}
        onComplete={(r) => {
          setResult(r);
          setStage("success");
        }}
        onBack={() => setStage("verify")}
      />
    );
  }

  return (
    <VerifyPage
      onVerified={(s) => {
        setSession(s);
        setStage("upload");
      }}
    />
  );
}
