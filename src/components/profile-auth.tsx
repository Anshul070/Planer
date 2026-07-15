import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";
import type { User } from "@supabase/supabase-js";

export function ProfileAvatar({ onLoginClick }: { onLoginClick: () => void }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // If user is logged in, show the avatar dropdown
  if (user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="hover:bg-surface-container-high transition-transform active:scale-95 p-1 rounded-full cursor-pointer">
            {user.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="Profile" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                {(user.email || user.user_metadata?.full_name || "U")[0].toUpperCase()}
              </div>
            )}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 bg-surface-container border-outline-variant">
          <div className="flex flex-col px-2 py-1.5 space-y-1 mb-2 border-b border-outline-variant/30">
            <span className="text-sm leading-none text-on-surface">{user.user_metadata?.full_name || "User"}</span>
            <span className="text-xs text-on-surface-variant truncate">{user.email}</span>
          </div>
          <DropdownMenuItem onClick={handleSignOut} className="text-error cursor-pointer focus:bg-error-container focus:text-on-error-container">
            <LogOut className="mr-2 w-4 h-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Not logged in -> Show generic avatar that opens modal
  return (
    <div 
      onClick={onLoginClick}
      className="hover:bg-surface-container-high transition-transform active:scale-95 p-1 rounded-full cursor-pointer"
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        <span className="material-symbols-outlined text-[20px]">person</span>
      </div>
    </div>
  );
}

export function LoginModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        scopes: "https://www.googleapis.com/auth/calendar.events",
        redirectTo: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
      }
    });
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      },
    });
    setLoading(false);
    if (!error) {
      setMagicLinkSent(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 min-h-screen flex flex-col justify-center items-center p-5 text-on-background bg-background">
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 w-10 h-10 bg-surface-container-high rounded-full flex items-center justify-center hover:bg-surface-variant active:scale-95 transition-all text-on-surface"
      >
        <span className="material-symbols-outlined">close</span>
      </button>
      <main className="w-full max-w-md flex flex-col items-center gap-8">
        {/* Illustration / Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-32 h-32 mb-4 bg-secondary-container rounded-full flex items-center justify-center shadow-[0px_4px_20px_rgba(0,0,0,0.5)] relative overflow-hidden">
            <span className="material-symbols-outlined text-[64px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              light_mode
            </span>
            <div className="absolute inset-0 bg-primary/10 animate-pulse rounded-full"></div>
          </div>
          <h1 className="font-headline text-2xl md:text-3xl text-primary">
            DinPlan
          </h1>
          <p className="font-body text-base text-on-surface-variant max-w-[250px]">
            Aapka friendly daily schedule planner.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-3 mt-8">
          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-2 bg-surface text-on-surface font-label text-sm py-4 px-6 rounded-2xl shadow-[0px_4px_20px_rgba(0,0,0,0.2)] border border-outline-variant hover:bg-surface-container transition-all active:scale-[0.98]"
          >
            <img 
              className="w-5 h-5 object-contain" 
              alt="Google" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDkDv9a4X7qOO3VdeZNDGtIZUhXQ-DzWXq6uL67AnJOOMS6iv-a1pYxm0O8bX-df0X86a5HYFlU7UFuCnKrVNm2d06kl7nplVAYVeLkAT42up8Deey7tDdvacLw-hsTMlVsFA6eDi3hugaAf3G6USi1TvIKyd-mP3OCVa4jRn5ll6fzIRzpWk_fdyuZ0GaVXt1Okjv6RZNsMWCtRdIpbv98tQB7eEdQvLvTIi0yXGx97tb0RDKKdkVxh1wNOO3X3d18EHGH81xsJQ"
            />
            <span>Continue with Google</span>
          </button>
          
          <div className="flex items-center gap-4 my-2">
            <div className="flex-1 h-px bg-outline-variant/30"></div>
            <span className="font-label text-xs text-on-surface-variant">or</span>
            <div className="flex-1 h-px bg-outline-variant/30"></div>
          </div>

          <form onSubmit={handleMagicLink} className="w-full flex flex-col gap-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
                mail
              </span>
              <input 
                className="w-full bg-surface-container border border-outline-variant rounded-2xl py-4 pl-12 pr-4 font-body text-base text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 shadow-[0px_4px_20px_rgba(0,0,0,0.1)] transition-all" 
                placeholder="Enter your email" 
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button 
              type="submit" 
              disabled={loading || magicLinkSent}
              className="w-full bg-primary text-on-primary font-label text-sm py-4 px-6 rounded-2xl shadow-[0px_4px_20px_rgba(0,0,0,0.3)] hover:bg-primary/90 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {magicLinkSent ? "Link Sent!" : loading ? "Sending..." : "Send Magic Link"}
              {!magicLinkSent && !loading && (
                <span className="material-symbols-outlined text-sm">
                  auto_awesome
                </span>
              )}
            </button>
          </form>
        </div>

        {/* Footer terms */}
        <p className="font-label text-xs text-on-surface-variant/60 text-center mt-4">
          By continuing, you agree to our Terms & Privacy Policy.
        </p>
      </main>
    </div>
  );
}
