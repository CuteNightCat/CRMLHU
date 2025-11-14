'use client';

import { useState, useEffect, useRef } from 'react';

export default function ChatLayout({ socket, conversations, setConversations, userInfo }) {
    const [activeThreadId, setActiveThreadId] = useState(null);
    const [messageInput, setMessageInput] = useState('');
    const [phoneInput, setPhoneInput] = useState('');
    const [searchResult, setSearchResult] = useState(null);

    const chatEndRef = useRef(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [conversations, activeThreadId]);

    const handleLogout = () => socket?.emit('request_logout');

    const handleSearch = (e) => {
        e.preventDefault();
        if (socket && phoneInput) {
            setSearchResult('Đang tìm kiếm...');
            socket.emit('search_user', phoneInput, (result) => setSearchResult(result));
        }
    };

    const handleSelectSearchResult = () => {
        if (searchResult && searchResult.uid) {
            const threadId = searchResult.uid;
            // Cập nhật state ở component cha (thông qua prop) nếu cần,
            // ở đây ta chỉ cần tự quản lý ở client
            if (!conversations[threadId]) {
                setConversations(prev => ({ ...prev, [threadId]: [] }));
            }
            setActiveThreadId(threadId);
            setSearchResult(null);
            setPhoneInput('');
        }
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (socket && messageInput && activeThreadId) {
            const tempMessageId = Date.now().toString();
            const newMessage = {
                id: tempMessageId,
                content: messageInput,
                sender: 'Me',
                isSelf: true,
                timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            };
            setConversations(prev => ({
                ...prev,
                [activeThreadId]: [newMessage, ...(prev[activeThreadId] || [])]
            }));

            socket.emit('send_message', { threadId: activeThreadId, text: messageInput }, (result) => {
                if (result.error) {
                    console.error('Send message failed:', result.error);
                    setConversations(prev => ({
                        ...prev,
                        [activeThreadId]: prev[activeThreadId].filter(msg => msg.id !== tempMessageId)
                    }));
                }
            });
            setMessageInput('');
        }
    };

    const activeConversation = conversations[activeThreadId] || [];

    return (
        <div style={styles.appContainer}>
            <div style={styles.sidebar}>
                <div style={styles.sidebarHeader}>
                    <h2>Zalo Chat</h2>
                    <button onClick={handleLogout} style={{ padding: '5px 10px' }}>Đăng xuất</button>
                </div>
                <form onSubmit={handleSearch} style={styles.searchContainer}>
                    <input type="text" placeholder="Tìm bằng SĐT..." value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} style={{ flexGrow: 1, marginRight: '10px' }} />
                    <button type="submit">Tìm</button>
                    {searchResult && (
                        <div style={{ width: '100%', marginTop: '10px' }}>
                            {typeof searchResult === 'string' && <p>{searchResult}</p>}
                            {searchResult?.error && <p style={{ color: 'red' }}>Lỗi: {searchResult.error}</p>}
                            {searchResult?.uid && (
                                <div style={styles.searchResultItem} onClick={handleSelectSearchResult}>
                                    <img src={searchResult.avatar} alt="avatar" style={{ width: 40, height: 40, borderRadius: '50%', marginRight: 10 }} />
                                    <div>
                                        <p style={{ fontWeight: 'bold', margin: 0 }}>{searchResult.zalo_name}</p>
                                        <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Bấm để bắt đầu chat</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </form>
                <div style={styles.contactList}>
                    {Object.keys(conversations).map(threadId => (
                        <div key={threadId} style={{ ...styles.contactItem, ...(threadId === activeThreadId ? styles.activeContact : {}) }} onClick={() => setActiveThreadId(threadId)}>
                            <p style={{ fontWeight: 'bold' }}>{userInfo[threadId]?.name || threadId}</p>
                            <p style={{ fontSize: '14px', color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conversations[threadId][0]?.content || ''}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div style={styles.chatWindow}>
                {activeThreadId ? (
                    <>
                        <div style={styles.chatHeader}><h3>{userInfo[activeThreadId]?.name || 'Chat'}</h3></div>
                        <div style={styles.messageArea}>
                            {activeConversation.slice().reverse().map(msg => (
                                <div key={msg.id} style={{ width: '100%', display: 'flex', justifyContent: msg.isSelf ? 'flex-end' : 'flex-start' }}>
                                    <div style={{ ...styles.messageBubble, ...(msg.isSelf ? styles.myMessage : styles.theirMessage) }}>
                                        {msg.content}
                                        <span style={styles.messageTimestamp}>{msg.timestamp}</span>
                                    </div>
                                </div>
                            ))}
                            <div ref={chatEndRef} />
                        </div>
                        <form onSubmit={handleSendMessage} style={styles.inputArea}>
                            <input type="text" placeholder="Nhập tin nhắn..." value={messageInput} onChange={(e) => setMessageInput(e.target.value)} style={{ flexGrow: 1, border: '1px solid #ccc', padding: '10px', borderRadius: '20px' }} />
                            <button type="submit" style={{ marginLeft: '10px', padding: '10px 20px', borderRadius: '20px', border: 'none', background: '#0068ff', color: 'white' }}>Gửi</button>
                        </form>
                    </>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}><p>Chọn một cuộc hội thoại để bắt đầu</p></div>
                )}
            </div>
        </div>
    );
}

const styles = {
    appContainer: { display: 'flex', height: '100vh', fontFamily: 'sans-serif' },
    sidebar: { width: '350px', borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column', background: 'white' },
    sidebarHeader: { padding: '10px 20px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    searchContainer: { padding: '10px', borderBottom: '1px solid #ddd', display: 'flex', flexWrap: 'wrap' },
    contactList: { flexGrow: 1, overflowY: 'auto' },
    contactItem: { padding: '15px 20px', borderBottom: '1px solid #eee', cursor: 'pointer' },
    activeContact: { backgroundColor: '#eef5ff' },
    chatWindow: { flexGrow: 1, display: 'flex', flexDirection: 'column', background: '#f5f5f5' },
    chatHeader: { padding: '20px', borderBottom: '1px solid #ddd', background: 'white' },
    messageArea: { flexGrow: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
    messageBubble: { padding: '10px 15px', borderRadius: '18px', marginBottom: '10px', maxWidth: '60%', position: 'relative' },
    myMessage: { background: '#0068ff', color: 'white' },
    theirMessage: { background: 'white', color: 'black', border: '1px solid #eee' },
    messageTimestamp: { fontSize: '11px', color: 'inherit', opacity: 0.7, display: 'block', textAlign: 'right', marginTop: '5px' },
    inputArea: { display: 'flex', padding: '20px', borderTop: '1px solid #ddd', background: 'white' },
    searchResultItem: { width: '100%', background: '#eef5ff', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', cursor: 'pointer', border: '1px solid #d0e0ff' },
};