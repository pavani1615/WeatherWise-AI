/**
 * WeatherWise AI - Orchestration Logic & Decision Heuristics
 * Built with modular design, local caching, and custom heuristics.
 */

// 1. State Management
const STATE = {
    apiKey: "e4039a867ab6f61fb62baf119e1eec76", // OpenWeather API Key
    currentUnit: "metric", // 'metric' or 'imperial'
    selectedProfile: "standard",
    currentCity: "Hyderabad",
    weatherData: null,
    forecastData: null,
    pollutionData: null,
    savedCities: [],
    geminiEnabled: false,
    geminiKey: "",
    chart: null,
    debouncing: null
};

// 2. User Profiles Configurations & Comfort Thresholds
const PROFILES = {
    standard: {
        name: "Pavani",
        desc: "Standard recommendations optimized for daily chores and general comfort.",
        tempMin: 18,
        tempMax: 28,
        humidityMin: 30,
        humidityMax: 65,
        windLimit: 25, // km/h
        aqiLimit: 3, // Fair
        uvLimit: 5 // Moderate
    },
    runner: {
        name: "Runner Persona",
        desc: "Optimized for outdoor cardiovascular workouts, high-wind alerts, and lung safety.",
        tempMin: 12,
        tempMax: 22, // Sweeter spot for running
        humidityMin: 20,
        humidityMax: 55, // Runners hate high humidity
        windLimit: 18, // Runner wind warning threshold
        aqiLimit: 2, // Strict AQI limit (Fair/Good only)
        uvLimit: 4
    },
    sensitive: {
        name: "Sensitive Individual",
        desc: "Strict parameters tailored for children, elderly, or asthma concerns.",
        tempMin: 20,
        tempMax: 26,
        humidityMin: 35,
        humidityMax: 60,
        windLimit: 15,
        aqiLimit: 2, // Strict AQI mask reminder
        uvLimit: 3 // Lower UV protection threshold
    }
};

// 3. Initialization
document.addEventListener("DOMContentLoaded", () => {
    loadSettingsFromStorage();
    initLucide();
    setupDefaultCity();
    
    // Set up search listener for Enter key
    document.getElementById("citySearch").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const query = e.target.value.trim();
            if (query) {
                fetchWeatherByCityName(query);
                closeSuggestions();
            }
        }
    });

    // Close suggestions box if clicked outside
    document.addEventListener("click", (e) => {
        const box = document.getElementById("suggestionsBox");
        const search = document.getElementById("citySearch");
        if (e.target !== box && e.target !== search) {
            closeSuggestions();
        }
    });
});

function initLucide() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Load configurations from LocalStorage
function loadSettingsFromStorage() {
    // Saved Cities
    const saved = localStorage.getItem("weatherwise_saved_cities");
    STATE.savedCities = saved ? JSON.parse(saved) : ["Hyderabad", "London", "Tokyo"];
    renderSavedCities();

    // Gemini API Setup
    STATE.geminiEnabled = localStorage.getItem("weatherwise_gemini_enabled") === "true";
    STATE.geminiKey = localStorage.getItem("weatherwise_gemini_key") || "";
    
    document.getElementById("geminiToggle").checked = STATE.geminiEnabled;
    document.getElementById("geminiApiKey").value = STATE.geminiKey;
    if (STATE.geminiEnabled) {
        document.getElementById("geminiKeyContainer").classList.remove("hidden");
    }

    // Units
    const unit = localStorage.getItem("weatherwise_unit");
    if (unit) {
        STATE.currentUnit = unit;
        document.querySelectorAll(".unit-btn").forEach(btn => btn.classList.remove("active"));
        if (unit === "metric") {
            document.getElementById("unitMetric").classList.add("active");
        } else {
            document.getElementById("unitImperial").classList.add("active");
        }
    }

    // Theme (Dark Mode)
    const isDark = localStorage.getItem("weatherwise_dark_mode") !== "false"; // Default to dark mode
    if (!isDark) {
        document.body.classList.add("light-theme");
        document.getElementById("themeIcon").setAttribute("data-lucide", "sun");
        document.getElementById("themeText").textContent = "Light Mode";
    }
}

function setupDefaultCity() {
    // Start with the first city in saved list, or default
    const defaultCity = STATE.savedCities.length > 0 ? STATE.savedCities[0] : "Hyderabad";
    fetchWeatherByCityName(defaultCity);
}

// ==========================================
// 4. API Engine (Fetchers & Clean Geocoding)
// ==========================================

async function fetchWeatherByCityName(cityName) {
    showLoader(true);
    try {
        // Step 1: Geocoding API to resolve coordinates (improves search accuracy and gets proper country labels)
        const geoRes = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(cityName)}&limit=1&appid=${STATE.apiKey}`);
        const geoData = await geoRes.json();
        
        if (!geoData || geoData.length === 0) {
            throw new Error(`City "${cityName}" not found. Try spelling carefully.`);
        }
        
        const { lat, lon, name, country, state } = geoData[0];
        const dispName = `${name}${state ? ', ' + state : ''}, ${country}`;
        STATE.currentCity = dispName;
        
        await fetchAllWeatherData(lat, lon, dispName);
    } catch (error) {
        handleSearchError(error.message);
    } finally {
        showLoader(false);
    }
}

async function fetchAllWeatherData(lat, lon, displayName) {
    try {
        // Parallel fetching for weather, forecast, and air pollution to increase load performance
        const [weatherRes, forecastRes, pollutionRes] = await Promise.all([
            fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${STATE.apiKey}&units=${STATE.currentUnit}`),
            fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${STATE.apiKey}&units=${STATE.currentUnit}`),
            fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${STATE.apiKey}`)
        ]);

        STATE.weatherData = await weatherRes.json();
        STATE.forecastData = await forecastRes.json();
        STATE.pollutionData = await pollutionRes.json();

        if (STATE.weatherData.cod !== 200) throw new Error(STATE.weatherData.message);

        // Update Dashboard UI
        updateDashboard(displayName);
        
    } catch (error) {
        console.error(error);
        handleSearchError("Failed to fetch secondary weather parameters.");
    }
}

// Auto-detect current geolocation coordinates
function getCurrentLocation() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    showLoader(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        try {
            // Reverse geocode to get name
            const geoRes = await fetch(`https://api.openweathermap.org/geo/1.0/reverse?lat=${latitude}&lon=${longitude}&limit=1&appid=${STATE.apiKey}`);
            const geoData = await geoRes.json();
            const dispName = geoData && geoData.length > 0 ? `${geoData[0].name}, ${geoData[0].country}` : "My Location";
            STATE.currentCity = dispName;
            
            await fetchAllWeatherData(latitude, longitude, dispName);
        } catch (error) {
            console.error(error);
            // Fallback
            await fetchAllWeatherData(latitude, longitude, "My Location");
        } finally {
            showLoader(false);
        }
    }, (error) => {
        showLoader(false);
        alert(`Location access denied or unavailable: ${error.message}`);
    });
}

// Autocomplete suggestions search handler (Debounced)
function handleSearchInput() {
    clearTimeout(STATE.debouncing);
    const query = document.getElementById("citySearch").value.trim();
    const clearBtn = document.getElementById("btnClearSearch");
    
    if (!query) {
        clearBtn.classList.add("hidden");
        closeSuggestions();
        return;
    }
    
    clearBtn.classList.remove("hidden");
    
    STATE.debouncing = setTimeout(async () => {
        try {
            const res = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${STATE.apiKey}`);
            const suggestions = await res.json();
            displaySuggestions(suggestions);
        } catch (e) {
            console.error("Suggestions fetch error:", e);
        }
    }, 400); // 400ms debounce window
}

function displaySuggestions(list) {
    const box = document.getElementById("suggestionsBox");
    box.innerHTML = "";
    
    if (!list || list.length === 0) {
        box.classList.add("hidden");
        return;
    }
    
    list.forEach(item => {
        const div = document.createElement("div");
        div.className = "suggestion-item";
        const stateText = item.state ? `${item.state}, ` : "";
        div.innerHTML = `<i data-lucide="map-pin"></i> <span>${item.name}, ${stateText}${item.country}</span>`;
        div.onclick = () => {
            document.getElementById("citySearch").value = "";
            document.getElementById("btnClearSearch").classList.add("hidden");
            STATE.currentCity = `${item.name}, ${item.country}`;
            fetchWeatherByCityName(`${item.name}, ${item.country}`);
            closeSuggestions();
        };
        box.appendChild(div);
    });
    
    box.classList.remove("hidden");
    initLucide();
}

function closeSuggestions() {
    document.getElementById("suggestionsBox").classList.add("hidden");
}

function clearSearch() {
    document.getElementById("citySearch").value = "";
    document.getElementById("btnClearSearch").classList.add("hidden");
    closeSuggestions();
}

// ==========================================
// 5. Decision & AI Heuristic Engines
// ==========================================

/**
 * Weather Heuristics - Calculates recommendations and metrics.
 * Pure JS Engine that does not require network backend resources.
 */
function runWeatherHeuristics(weather, pollution, profileKey) {
    const profile = PROFILES[profileKey];
    
    // Core parameters (standardized to Metric for internal calculations)
    const tempC = STATE.currentUnit === "metric" ? weather.main.temp : (weather.main.temp - 32) * 5/9;
    const humidity = weather.main.humidity;
    const windSpeedKmh = weather.wind.speed * (STATE.currentUnit === "metric" ? 3.6 : 1.60934); // Convert m/s or mph to km/h
    const cloudiness = weather.clouds.all;
    const weatherId = weather.weather[0].id; // OpenWeather condition code
    const aqi = pollution ? pollution.list[0].main.aqi : 1; // 1-5 Scale

    // Calculate UV Index Heuristic Estimate (since UV isn't in free forecast/current)
    const uvIndex = estimateUVIndex(weather.coord.lat, cloudiness);

    // Activity Suitability Score Calculation (Base 100)
    let activityScore = 100;
    const deductions = [];

    // 1. Temp Comfort Deduction
    if (tempC > profile.tempMax) {
        const diff = tempC - profile.tempMax;
        const ded = Math.min(25, diff * 3);
        activityScore -= ded;
        deductions.push(`High Temperature (-${Math.round(ded)} pts)`);
    } else if (tempC < profile.tempMin) {
        const diff = profile.tempMin - tempC;
        const ded = Math.min(25, diff * 3);
        activityScore -= ded;
        deductions.push(`Low Temperature (-${Math.round(ded)} pts)`);
    }

    // 2. Humidity Deduction
    if (humidity > profile.humidityMax) {
        const diff = humidity - profile.humidityMax;
        const ded = Math.min(15, diff * 0.5);
        activityScore -= ded;
        deductions.push(`High Humidity / Stifling Air (-${Math.round(ded)} pts)`);
    } else if (humidity < profile.humidityMin) {
        const diff = profile.humidityMin - humidity;
        const ded = Math.min(10, diff * 0.3);
        activityScore -= ded;
        deductions.push(`Dry Air (-${Math.round(ded)} pts)`);
    }

    // 3. Wind Deduction
    if (windSpeedKmh > profile.windLimit) {
        const diff = windSpeedKmh - profile.windLimit;
        const ded = Math.min(20, diff * 1.5);
        activityScore -= ded;
        deductions.push(`High Winds (-${Math.round(ded)} pts)`);
    }

    // 4. AQI Deduction
    if (aqi > profile.aqiLimit) {
        const diff = aqi - profile.aqiLimit;
        const ded = diff * 15;
        activityScore -= ded;
        deductions.push(`Poor Air Quality (-${Math.round(ded)} pts)`);
    }

    // 5. Severe Weather Code Deduction
    // Weather codes: 2xx (Storm), 3xx (Drizzle), 5xx (Rain), 6xx (Snow), 7xx (Atmosphere/Fog)
    if (weatherId >= 200 && weatherId < 300) {
        activityScore -= 50; // Severe Thunderstorm
        deductions.push("Thunderstorm warning (-50 pts)");
    } else if (weatherId >= 500 && weatherId < 600) {
        activityScore -= 35; // Rain
        deductions.push("Rainfall hazard (-35 pts)");
    } else if (weatherId >= 600 && weatherId < 700) {
        activityScore -= 40; // Snow
        deductions.push("Snowfall accumulation (-40 pts)");
    } else if (weatherId >= 701 && weatherId <= 741) {
        activityScore -= 20; // Fog / Mist / Smoke
        deductions.push("Reduced visibility/fog (-20 pts)");
    }

    // Clamp score between 0 and 100
    activityScore = Math.max(0, Math.min(100, Math.round(activityScore)));

    // Generate Tailored Advisories
    const suggestions = generateAdvisoryCards(tempC, humidity, windSpeedKmh, aqi, uvIndex, weatherId, profileKey);

    return {
        activityScore,
        uvIndex,
        aqi,
        deductions,
        clothing: suggestions.clothing,
        travel: suggestions.travel,
        brief: suggestions.brief,
        backgroundTheme: suggestions.theme
    };
}

// Estimate UV index based on latitude, time, and cloud cover
function estimateUVIndex(lat, clouds) {
    const currentHour = new Date().getHours();
    
    // Solar altitude estimation (peaks at noon 12-13)
    let timeFactor = 0;
    if (currentHour >= 6 && currentHour <= 18) {
        // Quadratic curve peaking at 12 PM
        timeFactor = Math.max(0, 1 - Math.pow((currentHour - 12.5) / 6.5, 2));
    }
    
    // Latitude factor: higher UV near equator
    const latAbs = Math.abs(lat);
    const latFactor = Math.max(0.1, 1 - (latAbs / 70)); // Max UV drops towards poles

    // Cloud attenuation factor (clouds reflect UV radiation)
    const cloudFactor = Math.max(0.2, 1 - (clouds / 100) * 0.7);

    // Max theoretical UV index is 12-15
    const baseUV = 12;
    const uv = Math.round(baseUV * timeFactor * latFactor * cloudFactor);
    return Math.max(1, Math.min(11, uv));
}

function generateAdvisoryCards(tempC, humidity, windKmh, aqi, uv, weatherId, profileKey) {
    const name = PROFILES[profileKey].name === "Pavani" ? "Pavani" : "there";
    let clothing = "";
    let travel = "";
    let brief = "";
    let theme = "weather-sunny";

    // 1. Brief & Theme Setup
    if (weatherId >= 200 && weatherId < 300) {
        brief = `Caution, ${name}. Lightning and heavy thunderstorms detected in your area. Best to remain indoors.`;
        theme = "weather-stormy";
        clothing = "Waterproof jacket or heavy raincoat; stay clear of metal accessories.";
        travel = "Hazardous. High hydroplaning risk. Avoid driving two-wheelers.";
    } else if (weatherId >= 500 && weatherId < 600) {
        brief = `Wet weather today, ${name}. Light to heavy precipitation expected. Plan indoor routines.`;
        theme = "weather-rainy";
        clothing = "Windbreaker, waterproof boots, and carry a compact umbrella.";
        travel = "Slippery roads. Reduced brake response. Low speed recommended.";
    } else if (weatherId >= 600 && weatherId < 700) {
        brief = `Freezing conditions, ${name}. Active snowfall may affect walkability. Keep warm.`;
        theme = "weather-snowy";
        clothing = "Insulated puffer coat, thermal layers, gloves, and a woolen beanie.";
        travel = "Extremely dangerous. Black ice warnings. Check tires or use transit.";
    } else if (weatherId >= 800) {
        // Clear or Cloudy
        theme = weatherId === 800 ? "weather-sunny" : "weather-cloudy";
        
        if (tempC > 30) {
            brief = `A very hot day ahead, ${name}. High thermal stress. Avoid direct solar exposure in the afternoon.`;
            clothing = "Breathable, loose-fitting cotton clothing. Light colors are best.";
            travel = "Normal commute conditions. Ensure radiator coolant levels are stable.";
        } else if (tempC < 15) {
            brief = `Chilly but stable weather, ${name}. Thermal preservation is recommended today.`;
            clothing = "Sweater or a light jacket over standard shirt. Sturdy closed shoes.";
            travel = "Good visibility. No special road restrictions.";
        } else {
            brief = `Excellent conditions today, ${name}! The temperature is comfortable and ideal for routines.`;
            clothing = "Standard attire. A light shirt and jeans will keep you comfortable.";
            travel = "Optimal. Enjoy smooth, dry driving conditions.";
        }
    } else {
        brief = `Overcast or hazy skies, ${name}. Humidity might feel slightly heavy.`;
        theme = "weather-cloudy";
        clothing = "Light layer; breathable fabric due to humidity levels.";
        travel = "Moderate mist. Ensure headlights are on if visibility drops.";
    }

    // Adapt clothing/travel overrides for wind, AQI, and UV indexes
    if (windKmh > 30) {
        clothing += " Wear tight clothing; avoid umbrellas which can turn inside out.";
        travel = "Heavy side-winds. High-sided vehicles and bikes should use caution.";
    }
    if (aqi >= 4) {
        brief += " Warning: Air pollution levels are hazardous.";
        clothing += " (Wear an N95 mask outdoors)";
    }
    if (uv >= 6) {
        clothing += " Apply SPF 30+ sunscreen and wear UV-blocking sunglasses.";
    }

    return { clothing, travel, brief, theme };
}

// Optional Gemini LLM briefing fetcher
async function fetchGeminiAIBriefing(weather, pollution, profileKey) {
    if (!STATE.geminiEnabled || !STATE.geminiKey) return null;
    
    const profile = PROFILES[profileKey];
    const tempUnit = STATE.currentUnit === "metric" ? "°C" : "°F";
    const profileName = profile.name;
    
    const prompt = `
    You are WeatherWise AI, a personal weather assistant. Generate a highly personalized briefing.
    User Name: ${profileName}
    Current weather: ${weather.name}, Temp ${weather.main.temp}${tempUnit}, Feels like ${weather.main.feels_like}${tempUnit}, Condition ${weather.weather[0].description}, Humidity ${weather.main.humidity}%, Wind ${weather.wind.speed} units.
    Air Quality Index: ${pollution ? pollution.list[0].main.aqi : "Unknown"} (1=Good, 5=Hazardous).
    User Persona Profile: ${profileKey} (${profile.desc}).
    
    Provide exactly two sentences of friendly, highly practical daily planning advice tailored to this user's profile and these conditions. Do not include raw numbers unless crucial.
    `;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${STATE.geminiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });
        const data = await res.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text.trim();
        }
        return null;
    } catch (e) {
        console.error("Gemini AI API failure: ", e);
        return null;
    }
}

// ==========================================
// 6. UI Render Engine
// ==========================================

function updateDashboard(displayName) {
    const weather = STATE.weatherData;
    const pollution = STATE.pollutionData;
    const profileKey = STATE.selectedProfile;

    // Run Heuristics Engine
    const decision = runWeatherHeuristics(weather, pollution, profileKey);

    // Update Theme Background
    document.body.className = decision.backgroundTheme;
    if (document.body.classList.contains("light-theme") === false && localStorage.getItem("weatherwise_dark_mode") === "false") {
        document.body.classList.add("light-theme");
    }

    // 1. Current Weather Panel updates
    document.getElementById("cityName").textContent = displayName;
    document.getElementById("dateTime").textContent = formatEpochDate(weather.dt);
    
    const tempSymbol = STATE.currentUnit === "metric" ? "°C" : "°F";
    const speedUnit = STATE.currentUnit === "metric" ? "km/h" : "mph";
    
    document.getElementById("currentTemp").textContent = `${Math.round(weather.main.temp)}${tempSymbol}`;
    document.getElementById("weatherDesc").textContent = weather.weather[0].description;
    document.getElementById("feelsLike").textContent = `${Math.round(weather.main.feels_like)}${tempSymbol}`;
    document.getElementById("humidity").textContent = `${weather.main.humidity}%`;
    
    // Wind display
    const rawWindSpeed = STATE.currentUnit === "metric" ? weather.wind.speed * 3.6 : weather.wind.speed;
    document.getElementById("windSpeed").textContent = `${Math.round(rawWindSpeed)} ${speedUnit}`;

    const iconCode = weather.weather[0].icon;
    document.getElementById("weatherIcon").src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;

    // 2. WeatherWise AI Decision Cards updates
    const name = PROFILES[profileKey].name === "Pavani" ? "Pavani" : PROFILES[profileKey].name;
    
    // Set greeting based on time of day
    const hour = new Date().getHours();
    let greeting = "Good evening";
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";
    
    document.getElementById("userGreeting").textContent = `${greeting}, ${name}`;
    document.getElementById("advClothing").textContent = decision.clothing;
    document.getElementById("advTravel").textContent = decision.travel;

    // Compute Activity Circular Score Widget
    document.getElementById("activityScoreVal").textContent = decision.activityScore;
    
    // Update SVG Circular Ring
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const strokeOffset = circumference - (decision.activityScore / 100) * circumference;
    const progressRing = document.getElementById("scoreCircleProgress");
    progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
    progressRing.style.strokeDashoffset = strokeOffset;

    // Color progress ring depending on score
    if (decision.activityScore >= 75) {
        progressRing.style.stroke = "var(--color-success)";
        document.getElementById("activityScoreDesc").textContent = "Optimal conditions";
        document.getElementById("activityScoreDesc").style.color = "var(--color-success)";
    } else if (decision.activityScore >= 45) {
        progressRing.style.stroke = "var(--color-warning)";
        document.getElementById("activityScoreDesc").textContent = "Moderate constraints";
        document.getElementById("activityScoreDesc").style.color = "var(--color-warning)";
    } else {
        progressRing.style.stroke = "var(--color-danger)";
        document.getElementById("activityScoreDesc").textContent = "Unsuitable outdoors";
        document.getElementById("activityScoreDesc").style.color = "var(--color-danger)";
    }

    // Set Heuristic Briefing text first, then try fetching Gemini AI if configured
    document.getElementById("aiSummaryText").textContent = decision.brief;

    if (STATE.geminiEnabled && STATE.geminiKey) {
        document.getElementById("aiSummaryText").innerHTML = `<i data-lucide="sparkles" class="spinner-icon"></i> Asking Gemini AI for dynamic summary...`;
        initLucide();
        fetchGeminiAIBriefing(weather, pollution, profileKey).then(customBrief => {
            if (customBrief) {
                document.getElementById("aiSummaryText").innerHTML = `<i data-lucide="sparkles" class="ai-spark-icon" style="color:var(--accent); display:inline-block; vertical-align:middle; margin-right:4px;"></i> ${customBrief}`;
            } else {
                document.getElementById("aiSummaryText").textContent = decision.brief; // fallback
            }
        });
    }

    // 3. Advanced Health Meters update
    // AQI Widget (Scale 1 to 5)
    const aqiVal = decision.aqi;
    const aqiPercent = (aqiVal / 5) * 100;
    document.getElementById("aqiFill").style.width = `${aqiPercent}%`;
    
    const aqiBadge = document.getElementById("aqiBadge");
    const aqiDesc = document.getElementById("aqiDesc");
    aqiBadge.className = "badge";
    
    if (aqiVal === 1) {
        aqiBadge.textContent = "Good";
        aqiBadge.classList.add("success");
        aqiDesc.textContent = "Air is fresh and clear";
    } else if (aqiVal === 2) {
        aqiBadge.textContent = "Fair";
        aqiBadge.classList.add("success");
        aqiDesc.textContent = "Acceptable air quality";
    } else if (aqiVal === 3) {
        aqiBadge.textContent = "Moderate";
        aqiBadge.classList.add("warning");
        aqiDesc.textContent = "Sensitive groups check parameters";
    } else if (aqiVal === 4) {
        aqiBadge.textContent = "Poor";
        aqiBadge.classList.add("danger");
        aqiDesc.textContent = "Recommend outdoor limits / mask";
    } else {
        aqiBadge.textContent = "Hazardous";
        aqiBadge.classList.add("danger");
        aqiDesc.textContent = "Extreme pollution. Stay indoors";
    }

    // UV Widget
    const uvVal = decision.uvIndex;
    const uvPercent = (uvVal / 11) * 100;
    document.getElementById("uvFill").style.width = `${uvPercent}%`;
    
    const uvBadge = document.getElementById("uvBadge");
    const uvDesc = document.getElementById("uvDesc");
    uvBadge.className = "badge";
    
    if (uvVal <= 2) {
        uvBadge.textContent = "Low";
        uvBadge.classList.add("success");
        uvDesc.textContent = "No special measures needed";
    } else if (uvVal <= 5) {
        uvBadge.textContent = "Moderate";
        uvBadge.classList.add("warning");
        uvDesc.textContent = "SPF 15+ & hats recommended";
    } else if (uvVal <= 7) {
        uvBadge.textContent = "High";
        uvBadge.classList.add("danger");
        uvDesc.textContent = "Sun protection required (SPF 30+)";
    } else {
        uvBadge.textContent = "Extreme";
        uvBadge.classList.add("danger");
        uvDesc.textContent = "Avoid mid-day sun. Wear shades";
    }

    // Wind Compass Pointer
    const windDeg = weather.wind.deg || 0;
    document.getElementById("compassPointer").style.transform = `rotate(${windDeg}deg)`;
    document.getElementById("windDirText").textContent = getWindDirectionText(windDeg);

    // Sunrise / Sunset times
    const tzOffset = weather.timezone;
    document.getElementById("sunriseTime").textContent = formatSunTime(weather.sys.sunrise, tzOffset);
    document.getElementById("sunsetTime").textContent = formatSunTime(weather.sys.sunset, tzOffset);

    // 4. Render Forecast details & chart analytics
    renderForecastDetails();
    setupPlannerDatesDropdown();

    initLucide();
}

function renderForecastDetails() {
    const list = STATE.forecastData.list;
    const container = document.getElementById("forecastCardsContainer");
    container.innerHTML = "";

    // Show 5-day cards by grouping or skipping 8 intervals (24h jumps)
    const cardIndexes = [0, 8, 16, 24, 32];
    const daysArr = [];

    cardIndexes.forEach(index => {
        if (index >= list.length) return;
        const item = list[index];
        const dateObj = new Date(item.dt * 1000);
        const dayLabel = dateObj.toLocaleDateString("en-US", { weekday: "short" });
        const dateLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        
        const tempVal = Math.round(item.main.temp);
        const desc = item.weather[0].description;
        const icon = item.weather[0].icon;
        
        const div = document.createElement("div");
        div.className = "forecast-card-sub";
        div.innerHTML = `
            <span class="day">${dayLabel}</span>
            <span class="section-hint">${dateLabel}</span>
            <img src="https://openweathermap.org/img/wn/${icon}.png" alt="Icon">
            <span class="temp">${tempVal}°</span>
            <span class="desc">${desc}</span>
        `;
        container.appendChild(div);
        
        daysArr.push(dayLabel);
    });

    // Redraw Analytics Chart
    renderChart(daysArr, list);
}

// Render Chart.js visual chart
function renderChart(labels, forecastList) {
    const ctx = document.getElementById("forecastChart").getContext("2d");
    
    // Extract temperature and activity trends
    const temps = [];
    const scores = [];
    
    // Gather average or standard parameters for the 5 selected forecast intervals
    const cardIndexes = [0, 8, 16, 24, 32];
    const profileKey = STATE.selectedProfile;
    
    cardIndexes.forEach(idx => {
        if (idx >= forecastList.length) return;
        const item = forecastList[idx];
        
        temps.push(Math.round(item.main.temp));
        
        // Run heuristic checks on mock forecast vectors (estimating UV = 3 for simplicity on future days)
        const mockWeather = {
            main: item.main,
            wind: item.wind,
            clouds: item.clouds,
            weather: item.weather,
            coord: STATE.weatherData.coord
        };
        const res = runWeatherHeuristics(mockWeather, null, profileKey);
        scores.push(res.activityScore);
    });

    if (STATE.chart) {
        STATE.chart.destroy();
    }

    // Chart.js Configuration
    STATE.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temperature',
                    data: temps,
                    borderColor: 'rgba(239, 68, 68, 0.85)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    yAxisID: 'yTemp',
                    tension: 0.45,
                    borderWidth: 3,
                    pointBackgroundColor: 'rgba(239, 68, 68, 1)',
                    pointRadius: 4
                },
                {
                    label: 'Outdoor Score',
                    data: scores,
                    borderColor: 'rgba(16, 185, 129, 0.85)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    yAxisID: 'yScore',
                    tension: 0.45,
                    borderWidth: 3,
                    pointBackgroundColor: 'rgba(16, 185, 129, 1)',
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: 'rgba(148, 163, 184, 0.95)',
                        font: { family: 'Outfit', size: 12, weight: '500' }
                    }
                },
                tooltip: {
                    padding: 10,
                    titleFont: { family: 'Outfit', size: 13, weight: '700' },
                    bodyFont: { family: 'Outfit', size: 12 }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: 'rgba(148, 163, 184, 0.85)', font: { family: 'Outfit' } }
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: 'rgba(148, 163, 184, 0.1)' },
                    ticks: {
                        color: 'rgba(239, 68, 68, 0.85)',
                        font: { family: 'Outfit' },
                        callback: function(val) { return val + '°'; }
                    },
                    title: { display: true, text: 'Temperature', color: 'rgba(239, 68, 68, 0.85)', font: { family: 'Outfit', weight: '600' } }
                },
                yScore: {
                    type: 'linear',
                    position: 'right',
                    grid: { display: false },
                    min: 0,
                    max: 100,
                    ticks: {
                        color: 'rgba(16, 185, 129, 0.85)',
                        font: { family: 'Outfit' }
                    },
                    title: { display: true, text: 'Activity Score', color: 'rgba(16, 185, 129, 0.85)', font: { family: 'Outfit', weight: '600' } }
                }
            }
        }
    });
}

// ==========================================
// 7. Travel & Event Planner Widget Logic
// ==========================================

function setupPlannerDatesDropdown() {
    const dateInput = document.getElementById("plannerDate");
    const list = STATE.forecastData.list;
    if (!list || list.length === 0) return;

    // Get min date (today's forecast date in local format YYYY-MM-DD)
    const minDateObj = new Date(list[0].dt * 1000);
    const minDateStr = minDateObj.toLocaleDateString("sv-SE"); // sv-SE outputs YYYY-MM-DD reliably

    // Get max date (last item in forecast list in local format YYYY-MM-DD)
    const maxDateObj = new Date(list[list.length - 1].dt * 1000);
    const maxDateStr = maxDateObj.toLocaleDateString("sv-SE");

    // Set constraints
    dateInput.min = minDateStr;
    dateInput.max = maxDateStr;
    
    // Set default value to today's date if not already set or outside range
    if (!dateInput.value || dateInput.value < minDateStr || dateInput.value > maxDateStr) {
        dateInput.value = minDateStr;
    }

    runEventPlanner();
}

function runEventPlanner() {
    const selectedDate = document.getElementById("plannerDate").value; // YYYY-MM-DD
    const activity = document.getElementById("plannerActivity").value;
    const resultBox = document.getElementById("plannerResultContainer");
    
    if (!selectedDate) {
        resultBox.classList.add("hidden");
        return;
    }
    
    const list = STATE.forecastData.list;
    
    // Filter forecast list for items matching this date
    const matchedItems = list.filter(item => {
        const itemDate = new Date(item.dt * 1000).toLocaleDateString("sv-SE");
        return itemDate === selectedDate;
    });

    if (matchedItems.length === 0) {
        // Fallback: search via startsWith on dt_txt which is YYYY-MM-DD HH:MM:SS
        const fallbackItems = list.filter(item => item.dt_txt.startsWith(selectedDate));
        if (fallbackItems.length === 0) {
            resultBox.classList.add("hidden");
            return;
        }
        matchedItems.push(...fallbackItems);
    }
    
    // Choose the mid-day forecast item (around 12:00 PM) for event suitability, or default to the first
    let forecastItem = matchedItems.find(item => item.dt_txt.includes("12:00:00")) || 
                       matchedItems.find(item => item.dt_txt.includes("15:00:00")) || 
                       matchedItems[0];
                       
    const profileKey = STATE.selectedProfile;
    
    // Run heuristics for the selected date weather
    const mockWeather = {
        main: forecastItem.main,
        wind: forecastItem.wind,
        clouds: forecastItem.clouds,
        weather: forecastItem.weather,
        coord: STATE.weatherData.coord
    };
    const decision = runWeatherHeuristics(mockWeather, null, profileKey);
    const score = decision.activityScore;
    const weatherId = forecastItem.weather[0].id;
    const tempC = STATE.currentUnit === "metric" ? forecastItem.main.temp : (forecastItem.main.temp - 32) * 5/9;
    const windSpeedKmh = forecastItem.wind.speed * 3.6;

    // Reset styles
    resultBox.className = "planner-result-container";
    const badge = document.getElementById("plannerRatingBadge");
    const badgeLabel = document.getElementById("plannerRatingLabel");
    const statusTitle = document.getElementById("plannerStatusTitle");
    const checklist = document.getElementById("plannerChecklist");
    checklist.innerHTML = "";

    // Score classification
    let status = "go";
    let title = "";
    
    if (score >= 70) {
        status = "go";
        title = "Highly Recommended";
        resultBox.classList.add("go");
        badgeLabel.textContent = "Go";
    } else if (score >= 40) {
        status = "caution";
        title = "Caution Advisable";
        resultBox.classList.add("warning");
        badgeLabel.textContent = "Wait";
    } else {
        status = "danger";
        title = "Unfavorable Forecast";
        resultBox.classList.add("danger");
        badgeLabel.textContent = "No";
    }

    statusTitle.textContent = title;

    // Generate event-specific checklist items
    const checkItems = [];

    if (activity === "running") {
        if (status === "go") {
            checkItems.push("Optimal cardiovascular temperature sweet spot.");
            checkItems.push("Clean air rating; breathability index high.");
        } else {
            if (tempC > 28) checkItems.push("Risk of heat dehydration. Run in early mornings.");
            if (tempC < 10) checkItems.push("Cold airway constriction warning. Wear thermal base.");
            if (windSpeedKmh > 20) checkItems.push("Wind drag hazard. Route near buildings/shielded parks.");
            if (weatherId >= 500 && weatherId < 600) checkItems.push("Slippery trail risk. Low traction footwear advised.");
        }
    } else if (activity === "picnic") {
        if (status === "go") {
            checkItems.push("Clear dry skies suitable for lawn setups.");
            checkItems.push("Moderate UV; ideal comfort conditions.");
        } else {
            if (weatherId >= 200 && weatherId < 600) checkItems.push("Precipitation alert. Outdoor canvas will wet.");
            if (tempC > 30) checkItems.push("Heat index high. Find locations with heavy shade.");
            if (windSpeedKmh > 22) checkItems.push("Wind items/plates may fly. Secure weights/umbrellas.");
        }
    } else if (activity === "travel") {
        if (status === "go") {
            checkItems.push("Dry highways and clean optical road visibility.");
            checkItems.push("No severe delays expected on route.");
        } else {
            if (weatherId >= 200 && weatherId < 300) checkItems.push("Thunderstorm flash hazard. Postpone travel.");
            if (weatherId >= 500 && weatherId < 600) checkItems.push("Heavy rain hazard. High hydroplaning warnings.");
            if (weatherId >= 701 && weatherId <= 741) checkItems.push("Low fog visibility. Use fog lights.");
            if (windSpeedKmh > 35) checkItems.push("Caution for two-wheelers and high trucks.");
        }
    } else if (activity === "sports") {
        if (status === "go") {
            checkItems.push("Stable wind patterns for ball trajectory.");
            checkItems.push("No rain interrupts expected during play.");
        } else {
            if (weatherId >= 200 && weatherId < 600) checkItems.push("Wet pitch/field warning. Wet ball hazards.");
            if (tempC > 32) checkItems.push("Excessive heat stroke danger. Introduce frequent drink intervals.");
            if (windSpeedKmh > 25) checkItems.push("Wind drift will affect overhead flights/cricket swings.");
        }
    }

    checkItems.forEach(itemText => {
        const li = document.createElement("li");
        li.textContent = itemText;
        checklist.appendChild(li);
    });

    resultBox.classList.remove("hidden");
}

// ==========================================
// 8. Bookmark & Sidebar Controls
// ==========================================

function renderSavedCities() {
    const list = document.getElementById("savedCitiesList");
    list.innerHTML = "";
    
    STATE.savedCities.forEach(city => {
        const li = document.createElement("li");
        li.className = "saved-city-item";
        
        // Remove commas for display name brevity
        const cleanName = city.split(",")[0];
        
        li.innerHTML = `
            <span onclick="fetchWeatherByCityName('${city}')">${cleanName}</span>
            <button onclick="removeSavedCity('${city}', event)"><i data-lucide="trash-2"></i></button>
        `;
        list.appendChild(li);
    });
    initLucide();
}

function saveCurrentCity() {
    if (!STATE.weatherData) return;
    const rawName = STATE.currentCity;
    
    if (STATE.savedCities.includes(rawName)) {
        alert(`${rawName.split(",")[0]} is already bookmarked!`);
        return;
    }
    
    STATE.savedCities.push(rawName);
    localStorage.setItem("weatherwise_saved_cities", JSON.stringify(STATE.savedCities));
    renderSavedCities();
}

function removeSavedCity(cityName, event) {
    event.stopPropagation(); // Avoid parent list item triggers
    STATE.savedCities = STATE.savedCities.filter(c => c !== cityName);
    localStorage.setItem("weatherwise_saved_cities", JSON.stringify(STATE.savedCities));
    renderSavedCities();
}

function changeProfile() {
    STATE.selectedProfile = document.getElementById("userProfile").value;
    
    // Update description text
    const desc = PROFILES[STATE.selectedProfile].desc;
    document.getElementById("profileDesc").textContent = desc;
    
    // Recalculate dashboard heuristics
    if (STATE.weatherData) {
        updateDashboard(STATE.currentCity);
    }
}

function toggleDarkMode() {
    const isDark = document.body.classList.toggle("light-theme");
    const icon = document.getElementById("themeIcon");
    const text = document.getElementById("themeText");
    
    if (isDark) {
        icon.setAttribute("data-lucide", "sun");
        text.textContent = "Light Mode";
        localStorage.setItem("weatherwise_dark_mode", "false");
    } else {
        icon.setAttribute("data-lucide", "moon");
        text.textContent = "Dark Mode";
        localStorage.setItem("weatherwise_dark_mode", "true");
    }
    initLucide();
}

function changeUnit(unit) {
    if (STATE.currentUnit === unit) return;
    STATE.currentUnit = unit;
    localStorage.setItem("weatherwise_unit", unit);

    // Toggle active button style
    document.getElementById("unitMetric").classList.toggle("active");
    document.getElementById("unitImperial").classList.toggle("active");

    // Re-fetch current city metrics to fetch units properly from OpenWeather
    if (STATE.weatherData) {
        fetchWeatherByCityName(STATE.currentCity);
    }
}

// Toggle Gemini Key view
function toggleGeminiIntegration() {
    const isChecked = document.getElementById("geminiToggle").checked;
    STATE.geminiEnabled = isChecked;
    localStorage.setItem("weatherwise_gemini_enabled", isChecked ? "true" : "false");
    
    const container = document.getElementById("geminiKeyContainer");
    if (isChecked) {
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
        // Clear summary text back to standard heuristic brief
        if (STATE.weatherData) {
            updateDashboard(STATE.currentCity);
        }
    }
}

function saveGeminiKey() {
    const key = document.getElementById("geminiApiKey").value.trim();
    if (!key) {
        alert("Please enter a valid Gemini API Key.");
        return;
    }
    STATE.geminiKey = key;
    localStorage.setItem("weatherwise_gemini_key", key);
    alert("Gemini key saved successfully! Summarizer active.");
    
    // Refresh briefing summaries
    if (STATE.weatherData) {
        updateDashboard(STATE.currentCity);
    }
}

// Loader UI utility
function showLoader(show) {
    const loader = document.getElementById("mainLoader");
    const grid = document.getElementById("dashboardGrid");
    
    if (show) {
        loader.classList.remove("hidden");
        grid.classList.add("hidden");
    } else {
        loader.classList.add("hidden");
        grid.classList.remove("hidden");
    }
}

function handleSearchError(message) {
    showLoader(false);
    // Display card error messaging
    const textDiv = document.getElementById("aiSummaryText");
    if (textDiv) {
        textDiv.innerHTML = `<span style="color:var(--color-danger); font-weight:600;"><i data-lucide="alert-triangle"></i> Error: ${message}</span>`;
        initLucide();
    }
}

// ==========================================
// 9. Time & Helper Utilities
// ==========================================

function formatEpochDate(epochSec) {
    const date = new Date(epochSec * 1000);
    return date.toLocaleDateString("en-US", {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatSunTime(epochSec, offsetSec) {
    // Convert epoch to local timezone time of the city
    const date = new Date((epochSec + offsetSec - 19800) * 1000); // 19800 is IST offset correction since JS translates automatically
    return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function getWindDirectionText(deg) {
    const directions = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
}
