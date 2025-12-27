/**
 * 共創カフェ 統合シフト・勤怠管理システム - カレンダー画面
 * v2.0 - GAS連携対応・リアルタイム更新
 */

(function() {
    'use strict';

    const elements = {
        filterStaff: document.getElementById('filterStaff'),
        calendarGrid: document.getElementById('calendarGrid'),
        dayDetail: document.getElementById('dayDetail'),
        selectedDateTitle: document.getElementById('selectedDateTitle'),
        dayDetailContent: document.getElementById('dayDetailContent'),
        statTotalSlots: document.getElementById('statTotalSlots'),
        statFilledSlots: document.getElementById('statFilledSlots'),
        statShortageSlots: document.getElementById('statShortageSlots'),
        statMyShifts: document.getElementById('statMyShifts'),
        btnRefresh: document.getElementById('btnRefresh')
    };

    let allShiftRequests = [];
    let selectedDate = null;

    /**
     * 初期化
     */
    async function init() {
        try {
            Utils.showLoading(true, 'データを読み込み中...');
            populateStaffFilter();
            setupEventListeners();
            await loadShiftData();
        } catch (error) {
            console.error('カレンダー初期化エラー:', error);
            Utils.showMessage('データの読み込みに失敗しました', 'error');
        } finally {
            Utils.showLoading(false);
        }
    }

    /**
     * スタッフフィルターを生成
     */
    function populateStaffFilter() {
        const options = CONFIG.STAFF_LIST.map(staff => {
            const roleLabel = CONFIG.ROLES[staff.role]?.label || '';
            const roleSuffix = roleLabel === 'リーダー' ? '（リーダー）' : '';
            return `<option value="${staff.id}">${staff.name}${roleSuffix}（${staff.id}）</option>`;
        }).join('');
        elements.filterStaff.innerHTML = '<option value="">全員</option>' + options;

        // 前回選択したスタッフを復元
        const lastStaffId = Utils.getFromStorage(CONFIG.STORAGE_KEYS.LAST_STAFF_ID);
        if (lastStaffId) {
            elements.filterStaff.value = lastStaffId;
        }
    }

    /**
     * イベントリスナーを設定
     */
    function setupEventListeners() {
        elements.filterStaff.addEventListener('change', () => {
            renderCalendar();
            updateStats();
        });

        // 更新ボタンがあれば
        if (elements.btnRefresh) {
            elements.btnRefresh.addEventListener('click', async () => {
                await loadShiftData();
            });
        }
    }

    /**
     * シフトデータをロード（GAS優先）
     */
    async function loadShiftData() {
        console.log('[calendar:loadShiftData] 開始');

        // まずローカルストレージから読み込み
        allShiftRequests = Utils.getFromStorage(CONFIG.STORAGE_KEYS.SHIFTS) || [];
        console.log('[calendar:loadShiftData] ローカルから読み込み:', allShiftRequests.length, '件');

        // GASが設定されている場合は、GASからも取得
        if (isConfigValid()) {
            try {
                Utils.showLoading(true, 'サーバーからデータを取得中...');
                console.log('[calendar:loadShiftData] GASから取得開始...');
                const response = await Utils.apiRequest('getAllShifts', {});
                console.log('[calendar:loadShiftData] GASレスポンス:', response);

                if (response.success && response.shifts) {
                    // GASのデータで上書き（GASが正）
                    allShiftRequests = response.shifts;
                    // ローカルストレージも同期
                    Utils.saveToStorage(CONFIG.STORAGE_KEYS.SHIFTS, allShiftRequests);
                    console.log('[calendar:loadShiftData] GASからシフトデータを取得:', allShiftRequests.length, '件');
                } else {
                    console.warn('[calendar:loadShiftData] GASレスポンスにshiftsがない:', response);
                }
            } catch (error) {
                console.warn('[calendar:loadShiftData] GASからのデータ取得に失敗、ローカルデータを使用:', error);
            } finally {
                Utils.showLoading(false);
            }
        } else {
            console.log('[calendar:loadShiftData] GAS未設定、ローカルデータのみ使用');
        }

        // データを正規化（日付とIDを文字列に）
        allShiftRequests = allShiftRequests.map(shift => ({
            ...shift,
            date: String(shift.date || '').split('T')[0],  // ISO形式の場合も対応
            staffId: String(shift.staffId || ''),
            slotId: String(shift.slotId || '')
        }));

        console.log('[calendar:loadShiftData] 最終データ:', allShiftRequests.length, '件');
        if (allShiftRequests.length > 0) {
            console.log('[calendar:loadShiftData] サンプル:', allShiftRequests[0]);
        }

        renderCalendar();
        updateStats();
    }

    /**
     * 日付文字列をパース
     */
    function parseDateStr(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    /**
     * カレンダーをレンダリング
     */
    function renderCalendar() {
        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const selectedStaffId = elements.filterStaff.value;
        const today = Utils.formatDate();

        // ヘッダー行
        let html = weekdays.map(w => `<div class="calendar-header">${w}</div>`).join('');

        // 期間の開始日を取得
        const period = getOperationPeriod();
        const startDate = parseDateStr(period.start);
        const endDate = parseDateStr(period.end);

        // 開始日の週の日曜日から始める
        const calendarStart = new Date(startDate);
        calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());

        // 終了日の週の土曜日まで
        const calendarEnd = new Date(endDate);
        calendarEnd.setDate(calendarEnd.getDate() + (6 - calendarEnd.getDay()));

        // カレンダーを生成
        let currentDate = new Date(calendarStart);
        while (currentDate <= calendarEnd) {
            const dateStr = Utils.formatDate(currentDate);
            const opDate = getOperationDate(dateStr);
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;

            if (!opDate) {
                // 営業日でない
                html += `<div class="calendar-day calendar-day--empty">
                    <div class="calendar-day__date">${currentDate.getDate()}</div>
                </div>`;
            } else {
                const dayShifts = allShiftRequests.filter(r => r.date === dateStr);
                const slotsHtml = renderDaySlots(dateStr, dayShifts, selectedStaffId);

                html += `
                    <div class="calendar-day ${isToday ? 'calendar-day--today' : ''} ${isSelected ? 'calendar-day--selected' : ''}"
                         data-date="${dateStr}">
                        <div class="calendar-day__date">${currentDate.getDate()}</div>
                        <div class="calendar-day__slots">
                            ${slotsHtml}
                        </div>
                    </div>
                `;
            }

            currentDate.setDate(currentDate.getDate() + 1);
        }

        elements.calendarGrid.innerHTML = html;

        // クリックイベント
        elements.calendarGrid.querySelectorAll('.calendar-day:not(.calendar-day--empty)').forEach(day => {
            day.addEventListener('click', () => showDayDetail(day.dataset.date));
        });
    }

    /**
     * 日付のスロットをレンダリング
     */
    function renderDaySlots(dateStr, dayShifts, selectedStaffId) {
        let html = '';
        const availableSlots = getAvailableSlots(dateStr);

        Object.entries(CONFIG.SHIFT_SLOTS).forEach(([slotId, slot]) => {
            const isAvailable = availableSlots.some(s => s.id === slotId);

            if (!isAvailable) {
                html += `<div class="calendar-slot calendar-slot--closed">${slot.label} -</div>`;
                return;
            }

            // slotIdを文字列として比較
            const slotShifts = dayShifts.filter(s => String(s.slotId) === String(slotId));
            const count = slotShifts.length;
            // 枠ごとの必要人数を取得（getRequiredStaff関数を使用）
            const required = getRequiredStaff(slotId);
            // staffIdも文字列として比較
            const isMine = selectedStaffId && slotShifts.some(s => String(s.staffId) === String(selectedStaffId));

            let statusClass = '';
            if (isMine) {
                statusClass = 'calendar-slot--mine';
            } else if (count >= required) {
                statusClass = 'calendar-slot--full';
            } else if (count > 0) {
                statusClass = 'calendar-slot--available';
            } else {
                statusClass = 'calendar-slot--shortage';
            }

            // 3人以上登録可能（上限なし）- 充足状態のみ表示
            html += `<div class="calendar-slot ${statusClass}">${slot.label} ${count}/${required}</div>`;
        });

        return html;
    }

    /**
     * 日付詳細を表示
     */
    function showDayDetail(dateStr) {
        selectedDate = dateStr;
        renderCalendar();

        const date = parseDateStr(dateStr);
        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        elements.selectedDateTitle.textContent =
            `${date.getMonth() + 1}/${date.getDate()}（${weekdays[date.getDay()]}）のシフト`;

        const dayShifts = allShiftRequests.filter(r => r.date === dateStr);
        const availableSlots = getAvailableSlots(dateStr);
        let html = '';

        Object.entries(CONFIG.SHIFT_SLOTS).forEach(([slotId, slot]) => {
            const isAvailable = availableSlots.some(s => s.id === slotId);
            // slotIdを文字列として比較
            const slotShifts = dayShifts.filter(s => String(s.slotId) === String(slotId));
            const count = slotShifts.length;
            // 枠ごとの必要人数を取得
            const required = getRequiredStaff(slotId);

            // ステータスクラス
            let statusClass = '';
            if (!isAvailable) {
                statusClass = 'day-detail__slot--closed';
            } else if (count >= required) {
                statusClass = 'day-detail__slot--full';
            } else if (count > 0) {
                statusClass = 'day-detail__slot--partial';
            } else {
                statusClass = 'day-detail__slot--empty';
            }

            html += `
                <div class="day-detail__slot ${statusClass}">
                    <div class="day-detail__slot-header">
                        <span class="day-detail__slot-label">${slot.label}（${slot.start}〜${slot.end}）</span>
                        <span class="day-detail__slot-count">${isAvailable ? `${count}/${required}名` : '営業なし'}</span>
                    </div>
                    <div class="day-detail__staff">
            `;

            if (!isAvailable) {
                html += `<span class="day-detail__empty">この日は${slot.label}営業なし</span>`;
            } else if (slotShifts.length > 0) {
                slotShifts.forEach(shift => {
                    html += `<span class="day-detail__staff-name">${Utils.escapeHtml(shift.staffName)}（${shift.staffId}）</span>`;
                });
                // 残り必要人数（上限なし - 充足状態のみ表示）
                if (count < required) {
                    html += `<span class="day-detail__need">あと${required - count}名必要</span>`;
                } else {
                    html += `<span class="day-detail__sufficient">必要人数達成</span>`;
                }
            } else {
                html += `<span class="day-detail__empty">申請者なし（${required}名必要）</span>`;
            }

            html += `
                    </div>
                </div>
            `;
        });

        elements.dayDetailContent.innerHTML = html;
        elements.dayDetail.style.display = 'block';
    }

    /**
     * 統計を更新
     */
    function updateStats() {
        const selectedStaffId = elements.filterStaff.value;
        const operationDates = getOperationDates();

        // 総枠数（営業している枠のみ）
        let totalSlots = 0;
        operationDates.forEach(dateStr => {
            const slots = getAvailableSlots(dateStr);
            totalSlots += slots.length;
        });
        elements.statTotalSlots.textContent = totalSlots;

        // 充足枠数（必要人数を満たしている枠）
        let filledSlots = 0;
        let shortageCount = 0;

        operationDates.forEach(dateStr => {
            const availableSlots = getAvailableSlots(dateStr);
            availableSlots.forEach(slot => {
                // 日付とslotIdを文字列として比較
                const count = allShiftRequests.filter(r =>
                    String(r.date) === String(dateStr) && String(r.slotId) === String(slot.id)
                ).length;

                // 枠ごとの必要人数を取得
                const required = getRequiredStaff(slot.id);
                if (count >= required) {
                    filledSlots++;
                } else {
                    shortageCount++;
                }
            });
        });

        elements.statFilledSlots.textContent = filledSlots;
        elements.statShortageSlots.textContent = shortageCount;

        // 自分の枠数
        if (selectedStaffId) {
            // staffIdを文字列として比較
            const myShifts = allShiftRequests.filter(r => String(r.staffId) === String(selectedStaffId));
            elements.statMyShifts.textContent = myShifts.length;
        } else {
            elements.statMyShifts.textContent = '-';
        }
    }

    // 初期化
    document.addEventListener('DOMContentLoaded', init);
})();
