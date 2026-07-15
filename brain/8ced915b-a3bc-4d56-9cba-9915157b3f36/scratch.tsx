  return (
    <div className="antialiased text-on-surface font-body-md min-h-screen flex flex-col relative pb-32 bg-background">
      {/* Top App Bar */}
      <header className="bg-surface dark:bg-surface-dim w-full top-0 sticky shadow-sm flex items-center justify-between px-container-margin h-16 z-40">
        <button 
          onClick={newDay}
          className="text-primary hover:bg-surface-container-high transition-transform active:scale-95 p-2 rounded-full flex items-center justify-center"
          title="Naya din plan karo"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>refresh</span>
        </button>
        <h1 className="font-headline-md text-headline-md text-primary font-bold">DinPlan</h1>
        <div className="hover:bg-surface-container-high transition-transform active:scale-95 rounded-full cursor-pointer">
          <ProfileAuth />
        </div>
      </header>

      {/* Main Content Canvas */}
      <main className="flex-grow px-container-margin pt-6 max-w-2xl mx-auto w-full">
        {/* VOICE MODE OVERLAY */}
        {voiceMode && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-surface/95 px-6 py-12 backdrop-blur-xl">
            <div className="w-full text-center mt-8">
              <p className="text-sm font-medium text-tertiary">Voice Mode</p>
              <h2 className="mt-4 font-display text-headline-lg text-primary">
                {sending
                  ? "Samajh raha hu..."
                  : transcribing
                  ? "Likha ja raha hai..."
                  : listening
                  ? "Bolo, sun raha hu..."
                  : "Mera jawab suno..."}
              </h2>
            </div>

            <div className="relative flex flex-col items-center justify-center h-48 w-48 mt-10">
              {(listening || sending || transcribing) && (
                <>
                  <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" style={{ animationDuration: '3s' }} />
                  <div className="absolute inset-4 animate-pulse rounded-full bg-primary/30" />
                </>
              )}
              <div className="z-10 grid h-32 w-32 place-items-center rounded-full bg-primary text-on-primary soft-shadow">
                <span className="material-symbols-outlined text-[48px]">mic</span>
              </div>
              
              {listening && !sending && !transcribing && (
                <div className="absolute -bottom-8 flex flex-col items-center">
                  <div ref={recordingTimerRef} className="text-3xl font-body-lg font-bold text-primary">
                    28s
                  </div>
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mt-1">Maximum</span>
                </div>
              )}
            </div>

            <div className="w-full mb-10">
              <p className="mb-10 text-center font-body-lg text-on-surface whitespace-pre-wrap max-h-40 overflow-y-auto">
                {day?.messages[day.messages.length - 1]?.role === "assistant" 
                    ? day.messages[day.messages.length - 1].content 
                    : ""}
              </p>
              <button
                onClick={toggleVoiceMode}
                className="mx-auto block rounded-full bg-surface-variant px-8 py-3 font-label-md text-label-md text-on-surface shadow-sm hover:bg-surface-container"
              >
                Exit Voice Mode
              </button>
            </div>
          </div>
        )}

        {/* CHAT TAB */}
        {tab === "chat" && (
          <div className="flex flex-col h-full relative">
            <div className="flex-1 space-y-4 pb-24">
              {streak > 0 && (
                <div className="flex items-center gap-2 rounded-2xl border border-tertiary/30 bg-tertiary-container/30 px-4 py-3 text-sm text-on-tertiary-container">
                  <span className="material-symbols-outlined text-tertiary">local_fire_department</span>
                  <span>
                    <span className="font-semibold">{streak} din</span> se on track ho, dost!
                  </span>
                </div>
              )}

              {!day && (
                <div className="grid place-items-center py-16 text-primary">
                  <span className="material-symbols-outlined animate-spin text-[32px]">progress_activity</span>
                </div>
              )}
              {day?.messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 font-body-md text-body-md whitespace-pre-wrap ${
                      m.role === "user" ? "bg-primary text-on-primary rounded-br-sm" : "bg-surface-container-high text-on-surface border border-outline-variant rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-surface-container-high border border-outline-variant flex items-center gap-2 rounded-2xl rounded-bl-sm px-4 py-4 text-on-surface-variant">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-error/30 bg-error-container/30 px-4 py-3 font-label-md text-error">
                  {error}
                </div>
              )}
              <div ref={chatEndRef} className="h-10" />
            </div>

            {/* Composer fixed at bottom above nav */}
            <div className="fixed bottom-24 left-0 right-0 px-4 max-w-2xl mx-auto z-30">
               {(listening || transcribing) && (
                <div className="mb-2 flex items-center gap-2 w-max mx-auto rounded-full bg-surface-container-high px-4 py-2 font-label-sm text-label-sm text-primary border border-outline-variant">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  {listening ? "Sun raha hu…" : "Samajh raha hu…"}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
                className="flex items-center gap-2 bg-surface-container-high p-2 rounded-3xl border border-outline-variant soft-shadow"
              >
                {speechSupported && (
                  <button
                    type="button"
                    onClick={listening ? stopListening : startListening}
                    disabled={sending || !day}
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${
                      listening
                        ? "bg-primary text-on-primary"
                        : "text-on-surface-variant hover:bg-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: listening ? "'FILL' 1" : "'FILL' 0" }}>
                      {listening ? "mic_off" : "mic"}
                    </span>
                  </button>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Apna din batao..."
                  className="max-h-32 min-h-[48px] flex-1 resize-none bg-transparent px-2 py-3 font-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
                  disabled={sending || !day}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim() || !day}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition disabled:opacity-40 active:scale-95"
                >
                  {sending ? (
                    <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* PLAN TAB */}
        {tab === "plan" && (
          <div className="pb-24">
            {!day && (
              <div className="grid place-items-center py-16 text-primary">
                <span className="material-symbols-outlined animate-spin text-[32px]">progress_activity</span>
              </div>
            )}
            
            {day && day.tasks.length === 0 && day.goals.length === 0 && (
              <div className="mt-10 rounded-2xl border border-dashed border-outline-variant bg-surface-variant p-8 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>calendar_today</span>
                </div>
                <h2 className="font-headline-md text-headline-md text-on-surface">Abhi plan khaali hai</h2>
                <p className="mt-2 font-body-md text-on-surface-variant">
                  Chat tab mein jaake apna din batao — schedule yaha ban jayega.
                </p>
                <button
                  onClick={() => setTab("chat")}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-label-md text-label-md text-on-primary active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>chat_bubble</span> Chat khol
                </button>
              </div>
            )}

            {day && (day.tasks.length > 0 || day.goals.length > 0) && (
              <>
                <div className="bg-surface-container-high rounded-xl p-3 mb-6 flex items-center justify-center border border-outline-variant">
                  <span className="material-symbols-outlined text-secondary mr-2 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>edit_note</span>
                  <span className="text-secondary font-label-md text-label-md">Draft — abhi ban raha hai</span>
                </div>

                <div className="mb-section-gap">
                  <div className="flex justify-between items-end mb-3">
                    <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary">Aaj ka Plan</h2>
                    <span className="font-label-sm text-label-sm text-secondary">{doneCount}/{totalCount} done</span>
                  </div>
                  <div className="w-full bg-surface-container-high rounded-full h-2.5">
                    <div className="bg-primary h-2.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                  </div>
                </div>

                {day.tasks.length > 0 && (
                  <div className="flex flex-col gap-stack-gap mb-section-gap relative">
                    {/* Connecting Line (Visual only) */}
                    <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-outline-variant/30 -z-10"></div>
                    
                    {day.tasks.map((t) => (
                      <div key={t.id} className={`rounded-xl p-card-padding soft-shadow flex items-start gap-4 transition-colors ${t.done ? 'bg-surface-container-high border-transparent' : 'bg-surface-variant border border-outline-variant/30'}`}>
                        <div className="flex-shrink-0 mt-1 cursor-pointer" onClick={() => toggleTask(t.id)}>
                          <span className={`material-symbols-outlined ${t.done ? 'text-primary' : 'text-outline'}`} style={{ fontVariationSettings: t.done ? "'FILL' 1" : "'FILL' 0" }}>
                            {t.done ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                        </div>
                        
                        {editingTaskId === t.id ? (
                          <div className="flex-grow flex flex-col gap-2">
                             <input 
                                type="text" 
                                value={newTaskName}
                                onChange={e => setNewTaskName(e.target.value)}
                                className="bg-background border border-outline-variant text-on-surface font-label-md text-label-md rounded-lg px-2 py-1 w-full focus:outline-none focus:border-primary"
                                placeholder={t.task}
                              />
                             <div className="flex items-center gap-2">
                              <input 
                                type="time" 
                                value={editStartTime}
                                onChange={e => setEditStartTime(e.target.value)}
                                className="bg-background border border-outline-variant text-on-surface font-label-sm text-label-sm rounded-lg px-2 py-1 flex-1 focus:outline-none focus:border-primary"
                              />
                              <span className="text-on-surface-variant font-label-sm text-label-sm">to</span>
                              <input 
                                type="time" 
                                value={editEndTime}
                                onChange={e => setEditEndTime(e.target.value)}
                                className="bg-background border border-outline-variant text-on-surface font-label-sm text-label-sm rounded-lg px-2 py-1 flex-1 focus:outline-none focus:border-primary"
                              />
                            </div>
                            <div className="flex gap-2 justify-end mt-2">
                              <button onClick={() => setEditingTaskId(null)} className="font-label-sm text-label-sm text-on-surface-variant px-3 py-1.5 rounded-lg border border-outline-variant">Cancel</button>
                              <button onClick={() => { handleSaveTaskEdit(t.id); setNewTaskName(""); }} className="font-label-sm text-label-sm bg-primary text-on-primary px-3 py-1.5 rounded-lg">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-grow cursor-pointer" onClick={() => toggleTask(t.id)}>
                            <h3 className={`font-label-md text-label-md ${t.done ? 'text-on-surface-variant line-through decoration-on-surface-variant/50' : 'text-on-surface'}`}>
                              {t.task}
                            </h3>
                            <div className="flex items-center gap-1 mt-1 text-secondary" onClick={(e) => { e.stopPropagation(); setEditingTaskId(t.id); setEditStartTime(t.startTime); setEditEndTime(t.endTime); setNewTaskName(t.task); }}>
                              <span className="material-symbols-outlined text-[14px]">schedule</span>
                              <span className="font-label-sm text-label-sm">{t.startTime}–{t.endTime}</span>
                              <span className="material-symbols-outlined text-[12px] ml-1 opacity-50 hover:opacity-100">edit</span>
                            </div>
                          </div>
                        )}
                        <button onClick={() => handleDeleteTask(t.id)} className="text-outline hover:text-error transition-colors p-2 -mr-2">
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    ))}
                    
                    {isAddingTask ? (
                      <div className="bg-surface-variant rounded-xl p-card-padding soft-shadow border border-outline-variant/30 flex flex-col gap-3">
                         <p className="font-label-md text-label-md text-on-surface">Add new task</p>
                          <input 
                            type="text" 
                            placeholder="Task name"
                            value={newTaskName}
                            onChange={e => setNewTaskName(e.target.value)}
                            className="bg-background border border-outline-variant text-on-surface font-body-md text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-primary"
                          />
                          <div className="flex items-center gap-2">
                            <input 
                              type="time" 
                              value={newStartTime}
                              onChange={e => setNewStartTime(e.target.value)}
                              className="bg-background border border-outline-variant text-on-surface font-label-sm text-sm rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-primary"
                            />
                            <span className="text-on-surface-variant text-sm">to</span>
                            <input 
                              type="time" 
                              value={newEndTime}
                              onChange={e => setNewEndTime(e.target.value)}
                              className="bg-background border border-outline-variant text-on-surface font-label-sm text-sm rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-primary"
                            />
                          </div>
                          <div className="flex justify-end gap-2 mt-1">
                            <button onClick={() => setIsAddingTask(false)} className="font-label-sm text-label-sm text-on-surface-variant px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container">
                              Cancel
                            </button>
                            <button onClick={handleAddTask} disabled={!newTaskName || !newStartTime || !newEndTime} className="font-label-sm text-label-sm bg-primary text-on-primary px-4 py-2 rounded-lg disabled:opacity-50">
                              Add Task
                            </button>
                          </div>
                      </div>
                    ) : (
                      <button onClick={() => setIsAddingTask(true)} className="flex items-center justify-center gap-2 py-3 px-4 border border-dashed border-primary/50 rounded-xl text-primary hover:bg-primary-container/10 transition-colors">
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        <span className="font-label-md text-label-md">Add task</span>
                      </button>
                    )}
                  </div>
                )}

                {day.goals.length > 0 && (
                  <div className="mb-section-gap">
                    <h3 className="font-label-md text-label-md text-secondary mb-3 uppercase tracking-wider">Aaj ke Goals</h3>
                    <div className="flex flex-wrap gap-inline-gap">
                      {day.goals.map((g) => (
                        <div 
                          key={g.id} 
                          onClick={() => toggleGoal(g.id)}
                          className={`px-4 py-2 rounded-xl font-label-sm text-label-sm flex items-center gap-2 cursor-pointer transition-colors border ${
                            g.done ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high text-primary border-primary/20 hover:bg-surface-container-highest"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {g.done ? "check_circle" : "flag"}
                          </span>
                          <span className={g.done ? "line-through opacity-80" : ""}>{g.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-8 mb-12 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between mb-4">
                    <span className="font-label-md text-label-md text-on-surface">Remind me before:</span>
                    <select 
                      value={reminderMin} 
                      onChange={e => setReminderMin(Number(e.target.value))}
                      className="bg-surface-container border border-outline-variant font-label-sm text-on-surface rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                    >
                      <option value={5}>5 mins</option>
                      <option value={10}>10 mins</option>
                      <option value={15}>15 mins</option>
                      <option value={30}>30 mins</option>
                    </select>
                  </div>
                  
                  {syncError && (
                    <div className="mb-4 text-sm text-error bg-error-container/30 rounded-lg p-3 w-full text-center">
                      {syncError}
                    </div>
                  )}

                  {syncError?.includes("disconnected") ? (
                    <button
                      onClick={async () => {
                        await supabase.auth.signInWithOAuth({
                          provider: "google",
                          options: { queryParams: { access_type: "offline", prompt: "consent" }, scopes: "https://www.googleapis.com/auth/calendar.events" }
                        });
                      }}
                      className="w-full bg-primary text-on-primary font-label-md text-label-md font-bold py-4 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform soft-shadow"
                    >
                      <span className="material-symbols-outlined">event</span> Connect Google Calendar
                    </button>
                  ) : (
                    <button
                      disabled={day.tasks.length === 0 || syncing}
                      onClick={async () => {
                        if (!day || !userId) return;
                        if (userId.startsWith("anon_")) { setSyncError("Please log in first to sync to calendar."); return; }
                        setSyncing(true); setSyncError(null);
                        try {
                          const res = await runSync({ data: { userId, dayDate: day.day_date, tasks: day.tasks, goals: day.goals, reminderMinutes: reminderMin } });
                          if (res.success) {
                            const updated = { ...day, tasks: res.tasks, goals: res.goals, synced_event_ids: res.syncedEventIds };
                            setDay(updated);
                            await persist({ tasks: res.tasks, goals: res.goals, synced_event_ids: res.syncedEventIds });
                          }
                        } catch (e: any) { setSyncError(e.message || "Failed to sync"); } finally { setSyncing(false); }
                      }}
                      className={`w-full font-label-md text-label-md font-bold py-4 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform ${
                        day.tasks.length === 0 || syncing ? "bg-surface-container text-on-surface-variant border border-outline-variant" : "bg-primary text-on-primary soft-shadow"
                      }`}
                    >
                      {syncing ? (
                        <span className="material-symbols-outlined animate-spin">progress_activity</span>
                      ) : day.synced_event_ids?.length ? (
                        <span className="material-symbols-outlined">check_circle</span>
                      ) : (
                        <span className="material-symbols-outlined">event</span>
                      )}
                      {syncing ? "Syncing..." : day.synced_event_ids?.length ? "Calendar par synced" : "Google Calendar par bhejo"}
                    </button>
                  )}
                  {!day.synced_event_ids?.length && !syncing && (
                    <span className="text-secondary font-label-sm text-label-sm mt-3 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">sync_problem</span> Not synced
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === "history" && (
          <div className="pb-24">
            {viewingDay ? (
              <ReadOnlyDayView day={viewingDay} onBack={() => setViewingDay(null)} />
            ) : (
              <>
                <div className="bg-surface-container-high rounded-xl p-4 mb-6 flex items-start gap-4 border border-outline-variant">
                  <span className="material-symbols-outlined text-primary text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                  <div>
                    <h3 className="font-label-md text-label-md text-on-surface">
                      {streak > 0 ? `${streak} din se on track ho!` : "Aaj se streak shuru karo"}
                    </h3>
                    <p className="font-body-md text-sm text-on-surface-variant mt-1">
                      {streak > 0 ? "Roz plan banate raho — streak tootne mat dena." : "Aaj ka plan banao aur roz aage badhao."}
                    </p>
                  </div>
                </div>

                <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary mb-4">Beete Din</h2>
                
                {history.filter((h) => h.day_date !== todayDate() && h.tasks.length > 0).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-variant p-8 text-center mt-4">
                    <p className="font-body-md text-on-surface-variant">
                      Abhi tak koi beeta din nahi hai. Roz plan banao — yaha history dikhegi.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {history.filter((h) => h.day_date !== todayDate() && h.tasks.length > 0).map((h) => {
                      const done = h.tasks.filter((t) => t.done).length;
                      const total = h.tasks.length;
                      const goalsDone = h.goals.filter((g) => g.done).length;
                      const goalsTotal = h.goals.length;
                      const complete = total > 0 && done === total;
                      return (
                        <div 
                          key={h.id} 
                          onClick={() => setViewingDay(h)}
                          className="bg-surface-variant border border-outline-variant/30 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-surface-container-high transition-colors"
                        >
                          <div>
                            <h3 className="font-label-md text-label-md text-on-surface">{formatDayLabel(h.day_date)}</h3>
                            <p className="font-label-sm text-label-sm text-secondary mt-1">
                              {done}/{total} tasks done {goalsTotal > 0 && ` • ${goalsDone}/${goalsTotal} goals`}
                            </p>
                          </div>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-label-sm ${complete ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                            {Math.round((done / total) * 100)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Bottom Nav Bar */}
      <nav className="bg-surface/90 dark:bg-surface-dim/90 backdrop-blur-md fixed bottom-0 w-full z-50 rounded-t-xl shadow-[0px_-4px_20px_rgba(0,0,0,0.5)] flex justify-around items-center h-20 pb-safe px-4 border-t border-outline-variant/20">
        <TabButton
          active={tab === "chat"}
          onClick={() => { setTab("chat"); setViewingDay(null); }}
          icon="chat_bubble"
          label="Chat"
        />
        
        <div className="relative w-16 flex justify-center">
          <TabButton
            active={tab === "plan"}
            onClick={() => { setTab("plan"); setViewingDay(null); }}
            icon="calendar_today"
            label="Aaj ka Plan"
            isCenter
          />
          <button 
            onClick={toggleVoiceMode}
            className={`absolute -top-12 bg-primary text-on-primary rounded-full w-16 h-16 flex items-center justify-center soft-shadow active:scale-90 transition-transform border-4 border-surface z-10 ${voiceMode ? 'animate-pulse' : ''}`}
          >
            <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
          </button>
        </div>

        <TabButton
          active={tab === "history"}
          onClick={() => { setTab("history"); setViewingDay(null); }}
          icon="history"
          label="Beete Din"
        />
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, isCenter }: { active: boolean; onClick: () => void; icon: string; label: string; isCenter?: boolean }) {
  return (
    <div 
      onClick={onClick}
      className={`flex flex-col items-center justify-center transition-all duration-200 active:scale-90 hover:bg-surface-container-high p-2 rounded-lg cursor-pointer ${isCenter ? 'mt-2 w-full' : 'w-16'} ${active ? 'text-primary font-bold' : 'text-secondary'}`}
    >
      <span className="material-symbols-outlined mb-1" style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>{icon}</span>
      <span className="font-label-sm text-label-sm text-[10px]">{label}</span>
    </div>
  );
}

function ReadOnlyDayView({ day, onBack }: { day: DayDoc; onBack: () => void }) {
  const done = day.tasks.filter((t) => t.done).length;
  const total = day.tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 font-label-sm text-label-sm text-on-surface hover:bg-surface-container-high"
      >
        <span className="material-symbols-outlined text-[16px]">chevron_left</span> Wapas
      </button>
      <div className="mb-section-gap">
        <div className="flex justify-between items-end mb-3">
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary">{formatDayLabel(day.day_date)}</h2>
          <span className="font-label-sm text-label-sm text-secondary">{done}/{total} done</span>
        </div>
        <div className="w-full bg-surface-container-high rounded-full h-2.5">
          <div className="bg-primary h-2.5 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
      
      {day.tasks.length > 0 && (
        <div className="flex flex-col gap-stack-gap mb-section-gap relative">
          <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-outline-variant/30 -z-10"></div>
          {day.tasks.map((t) => (
            <div key={t.id} className={`rounded-xl p-card-padding soft-shadow flex items-start gap-4 ${t.done ? 'bg-surface-container-high' : 'bg-surface-variant border border-outline-variant/30'}`}>
              <div className="flex-shrink-0 mt-1">
                <span className={`material-symbols-outlined ${t.done ? 'text-primary' : 'text-outline'}`} style={{ fontVariationSettings: t.done ? "'FILL' 1" : "'FILL' 0" }}>
                  {t.done ? 'check_circle' : 'radio_button_unchecked'}
                </span>
              </div>
              <div className="flex-grow">
                <h3 className={`font-label-md text-label-md ${t.done ? 'text-on-surface-variant line-through decoration-on-surface-variant/50' : 'text-on-surface'}`}>
                  {t.task}
                </h3>
                <div className="flex items-center gap-1 mt-1 text-secondary">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  <span className="font-label-sm text-label-sm">{t.startTime}–{t.endTime}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {day.goals.length > 0 && (
        <div className="mb-section-gap">
          <h3 className="font-label-md text-label-md text-secondary mb-3 uppercase tracking-wider">Goals</h3>
          <div className="flex flex-wrap gap-inline-gap">
            {day.goals.map((g) => (
              <div 
                key={g.id} 
                className={`px-4 py-2 rounded-xl font-label-sm text-label-sm flex items-center gap-2 border ${g.done ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high text-primary border-primary/20"}`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {g.done ? "check_circle" : "flag"}
                </span>
                <span className={g.done ? "line-through opacity-80" : ""}>{g.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
