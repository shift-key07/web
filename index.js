// Firebase Client SDK 모듈 가져오기
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, onValue, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

// 사용자가 제공한 RTDB URL. 
const USER_DB_URL = "https://hackathon-13e76-default-rtdb.asia-southeast1.firebasedatabase.app"; 

// DOM 요소 참조
const loadingElement = document.getElementById('loading');
const navTabs = document.getElementById('nav-tabs');
const detailView = document.getElementById('detail-view');
const messageBox = document.getElementById('message-box');

// 전역 상태 변수
let db = null;
let allHospitalsData = {}; // 전체 병원 데이터를 저장할 객체
let currentHospitalId = null; // 현재 선택된 병원 ID

// 각 병원 ID에 대한 센스있는 소개 문구
const HOSPITAL_INTRODUCTIONS = {
    'hospital_A': '최고의 심장 전문의들이 24시간 대기하며 생명을 지키는 곳, A 병원입니다.',
    'hospital_B': '외상 치료의 골든타임을 책임지는 신속함! B 병원에서 안심하고 치료받으세요.',
    'hospital_C': '소아부터 노인까지, 온 가족이 신뢰하는 통합 진료 시스템을 갖춘 C 병원입니다.',
    'hospital_D': '뇌졸중, 신경계 질환에 특화된 최첨단 장비와 전문 인력을 보유하고 있습니다.',
    'hospital_E': '화상 및 중증 외과 수술에 특화된 지역 거점 병원으로서의 역할을 다합니다.',
    'hospital_F': '각 분야 최고의 베테랑 내과 전문의들이 복잡한 내과 질환을 진단하고 치료합니다.',
    'hospital_G': '희귀 질환 및 이식 수술 분야에서 독보적인 기술력을 자랑하는 G 병원입니다.'
    // 실제 DB 데이터와 ID가 다를 경우, 여기에 추가하거나 DB 데이터를 확인하여 매칭해주세요.
};

/**
 * 사용자에게 메시지를 표시하는 함수
 * @param {string} message - 표시할 메시지
 * @param {boolean} isSuccess - 성공(true) 또는 실패(false) 여부
 */
const showMessage = (message, isSuccess = true) => {
    messageBox.textContent = message;
    messageBox.classList.remove('hidden', 'bg-red-500', 'bg-green-500');
    messageBox.classList.add(isSuccess ? 'bg-green-500' : 'bg-red-500');
    
    setTimeout(() => {
        messageBox.classList.add('hidden');
    }, 3000);
};

// --- 1. Firebase 초기화 ---
const initializeFirebase = () => {
    // 캔버스 환경에서 제공되는 전역 설정 변수 사용
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;

    if (firebaseConfig) {
        try {
            // 사용자 URL로 databaseURL 속성을 덮어씌웁니다.
            firebaseConfig.databaseURL = USER_DB_URL; 

            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
            loadingElement.textContent = '데이터베이스 연결 성공. 데이터 수신 대기 중...';
            startRealtimeListener(); // 초기화 성공 후 리스너 시작
        } catch (error) {
            loadingElement.textContent = `Firebase 초기화 실패: ${error.message}. 콘솔을 확인하세요.`;
            console.error("Firebase Initialization Error:", error);
        }
    } else {
        loadingElement.textContent = '오류: Firebase 설정 정보(__firebase_config)를 찾을 수 없습니다.';
        console.error("Configuration Error: __firebase_config is missing.");
    }
};


// --- 2. Realtime Database 상태 업데이트 (트랜잭션) ---
// window 객체에 등록하여 HTML에서 직접 호출 가능하게 함
window.updateBedStatus = (hospitalId, change) => {
    if (!db) return;

    const hospitalRef = ref(db, `hospitals/${hospitalId}`);
    const status = change === -1 ? "입원" : "퇴원";

    runTransaction(hospitalRef, (currentStatus) => {
        if (currentStatus === null) {
            showMessage(`[${status}] 실패: 병원 데이터를 찾을 수 없습니다.`, false);
            return;
        }

        const available = currentStatus.available_er_beds || 0;
        const occupied = currentStatus.occupied_er_beds || 0;
        const total = currentStatus.total_er_beds || 0;

        const newAvailable = available + change;
        const newOccupied = occupied - change;

        // 유효성 검사 (0 미만 또는 총 병상 수 초과 방지)
        if (newAvailable < 0 || newAvailable > total) {
            const message = `[${status}] 실패: ${currentStatus.name} 병상 수 (${newAvailable} / ${total})가 범위를 벗어납니다.`;
            console.warn(message);
            showMessage(message, false);
            return; 
        }
        
        // 새로운 상태로 업데이트
        currentStatus.available_er_beds = newAvailable;
        currentStatus.occupied_er_beds = newOccupied;
        
        return currentStatus; // 업데이트된 객체를 반환하면 DB에 커밋됩니다.
    })
    .then((result) => {
        // committed가 true일 때만 성공 메시지 표시
        if (result.committed) {
            showMessage(`${result.snapshot.val().name}: 환자 ${status} 처리 완료! (가용: ${result.snapshot.val().available_er_beds})`, true);
        }
    })
    .catch((error) => {
        console.error("Transaction failed:", error);
        showMessage(`[${status}] DB 트랜잭션 중 심각한 오류 발생.`, false);
    });
};

// --- 3. 상세 정보 렌더링 함수 ---
// window 객체에 등록하여 HTML에서 직접 호출 가능하게 함
window.displayHospitalDetail = (hospitalId) => {
    currentHospitalId = hospitalId;
    const hospital = allHospitalsData[hospitalId];

    if (!hospital) {
        detailView.innerHTML = '<div class="text-center text-gray-500 py-12">선택된 병원 정보가 없습니다.</div>';
        return;
    }

    // 탭 활성화 상태 업데이트
    document.querySelectorAll('#nav-tabs button').forEach(button => {
        if (button.dataset.id === hospitalId) {
            button.classList.add('tab-active');
        } else {
            button.classList.remove('tab-active');
        }
    });

    const available = hospital.available_er_beds || 0;
    const total = hospital.total_er_beds || 0;
    const occupied = hospital.occupied_er_beds || 0;
    const specialists = hospital.specialists || [];
    
    // 가용 병상 비율 계산 및 색상 결정
    const utilization = occupied / total;
    let statusColor = 'bg-green-500'; 
    if (utilization >= 0.8) {
        statusColor = 'bg-red-500'; 
    } else if (utilization >= 0.5) {
        statusColor = 'bg-yellow-500'; 
    }
    
    const introSentence = HOSPITAL_INTRODUCTIONS[hospitalId] || '환자 중심의 의료 서비스를 제공합니다.';

    const cardHtml = `
        <div class="hospital-card bg-white p-6 rounded-xl shadow-md border-t-8 ${statusColor.replace('bg-', 'border-')} flex flex-col justify-between h-full">
            <div>
                <h2 class="text-3xl font-bold text-gray-800 mb-2">${hospital.name}</h2>
                <p class="text-sm text-gray-500 mb-4">ID: ${hospitalId}</p>

                <!-- 센스있는 소개 문구 -->
                <div class="p-3 mb-4 bg-blue-50 rounded-lg border-l-4 border-blue-500">
                    <p class="text-blue-800 font-medium">${introSentence}</p>
                </div>
                
                <!-- 병상 현황 바 -->
                <div class="mb-4">
                    <p class="text-sm font-medium text-gray-700">병상 가용 현황:</p>
                    <div class="w-full bg-gray-200 rounded-full h-3.5">
                        <div class="h-3.5 rounded-full ${statusColor}" style="width: ${utilization * 100}%"></div>
                    </div>
                    <p class="text-2xl font-extrabold mt-2 text-gray-900">
                        <span class="text-green-600">${available}</span> / <span class="text-gray-400">${total}</span> (사용 중: ${occupied})
                    </p>
                </div>

                <!-- 특화 진료과 목록 -->
                <div class="mb-4">
                    <p class="text-sm font-medium text-gray-700 mb-1">특화 진료과:</p>
                    <div class="flex flex-wrap gap-2">
                        ${specialists.map(s => `<span class="px-3 py-1 text-sm font-semibold rounded-full bg-indigo-100 text-indigo-800">${s}</span>`).join('')}
                    </div>
                </div>
            </div>

            <!-- 상태 업데이트 버튼 -->
            <div class="flex space-x-3 mt-4 pt-4 border-t border-gray-100">
                <button onclick="updateBedStatus('${hospitalId}', -1)" 
                        class="flex-1 py-3 px-4 text-base font-bold rounded-lg text-white ${available > 0 ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-400 cursor-not-allowed'}" 
                        ${available <= 0 ? 'disabled' : ''}>
                    환자 입원 (-1)
                </button>
                <button onclick="updateBedStatus('${hospitalId}', 1)" 
                        class="flex-1 py-3 px-4 text-base font-bold rounded-lg text-indigo-600 border border-indigo-600 hover:bg-indigo-50"
                        ${occupied <= 0 ? 'disabled' : ''}>
                    환자 퇴원 (+1)
                </button>
            </div>
        </div>
    `;
    detailView.innerHTML = cardHtml;
};


// --- 4. 실시간 데이터 리스너 설정 ---
const startRealtimeListener = () => {
    if (!db) return;
    
    const hospitalsRef = ref(db, 'hospitals');

    onValue(hospitalsRef, (snapshot) => {
        loadingElement.classList.add('hidden'); 

        if (!snapshot.exists()) {
            detailView.innerHTML = '<div class="text-center text-gray-500 py-12">데이터베이스에 병원 정보가 없습니다.</div>';
            navTabs.innerHTML = '';
            return;
        }

        const hospitals = snapshot.val();
        allHospitalsData = hospitals; // 전체 데이터 업데이트
        
        // 탭 네비게이션 재구성
        navTabs.innerHTML = '';
        const hospitalIds = Object.keys(hospitals);
        
        hospitalIds.forEach(hospitalId => {
            const hospital = hospitals[hospitalId];
            const button = document.createElement('button');
            button.textContent = hospital.name;
            button.dataset.id = hospitalId;
            // HTML에서 호출될 수 있도록 window에 등록된 함수를 사용
            button.className = 'flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-gray-700 bg-gray-100 hover:bg-blue-50 transition duration-150';
            button.onclick = () => window.displayHospitalDetail(hospitalId);
            navTabs.appendChild(button);
        });
        
        // 데이터 업데이트 후, 이전에 선택된 병원이 있다면 그 병원의 상세 정보를 업데이트
        // 아니면 목록의 첫 번째 병원을 자동으로 선택
        const idToDisplay = currentHospitalId && hospitalIds.includes(currentHospitalId) 
                            ? currentHospitalId 
                            : hospitalIds[0];
        
        if (idToDisplay) {
            window.displayHospitalDetail(idToDisplay);
        } else {
            detailView.innerHTML = '<div class="text-center text-gray-500 py-12">표시할 병원이 없습니다.</div>';
        }

    }, (error) => {
        loadingElement.classList.add('hidden');
        detailView.innerHTML = `<div class="text-center text-red-600 col-span-full py-12">데이터 읽기 실패: ${error.message}</div>`;
        console.error("RTDB Read Error:", error);
    });
};

// 페이지 로드 시 Firebase 초기화 시작
initializeFirebase();
