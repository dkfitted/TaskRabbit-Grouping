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
      <div className="min-h-screen flex items-center justify-center bg-[#F9F9F7] p-6">
        <div className="w-full max-w-sm animate-fade-up">
          {/* Card */}
          <div className="bg-white rounded-3xl border border-[#E8E8E5] p-10 text-center shadow-sm">
            {/* Animated checkmark */}
            <div className="flex justify-center mb-8">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-[#0D0D0D] flex items-center justify-center animate-scale-in">
                  <svg className="w-9 h-9" viewBox="0 0 24 24" fill="none">
                    <path
                      className="check-path"
                      d="M5 13l4 4L19 7"
                      stroke="white"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </div>

            <h1 className="font-display text-[32px] font-bold text-[#0D0D0D] mb-1 tracking-tight">
              All done.
            </h1>
            <p className="text-[14px] text-[#8C8C8C] mb-8">
              Uploaded to Fitted successfully
            </p>

            {/* Stats */}
            <div className="flex items-center justify-center gap-6 mb-8 py-5 border-y border-[#F0F0EE]">
              <div className="text-center">
                <p className="font-display text-4xl font-bold text-[#0D0D0D]">{result.itemCount}</p>
                <p className="text-[12px] text-[#9A9A94] mt-1 tracking-wide uppercase">items</p>
              </div>
              <div className="w-px h-10 bg-[#E8E8E5]" />
              <div className="text-center">
                <p className="font-display text-4xl font-bold text-[#0D0D0D]">{result.photoCount}</p>
                <p className="text-[12px] text-[#9A9A94] mt-1 tracking-wide uppercase">photos</p>
              </div>
            </div>

            <button
              onClick={() => {
                setStage("verify");
                setSession(null);
                setResult(null);
              }}
              className="w-full h-14 bg-[#0D0D0D] text-white font-medium rounded-2xl hover:bg-black transition-colors text-[15px] tracking-[-0.01em]"
            >
              Next customer →
            </button>
          </div>
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
